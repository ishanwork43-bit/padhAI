"""FastAPI application for the integrated PadhAI frontend."""

from collections import OrderedDict, deque
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from threading import Lock
from typing import Literal
from urllib.parse import unquote_to_bytes
import asyncio
import hmac
import math
import time
import logging

from fastapi import FastAPI, Request, Response, Depends, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from api.config import APIConfig
from api.errors import APIError
from api.service import StudyService, csrf_token


class RateLimits:
    """Bounded, single-process rate counters; proxy headers are never trusted blindly."""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = Lock()
        self.buckets = OrderedDict()

    def check(self, key, maximum, seconds=60):
        with self.lock:
            now = self.clock()
            bucket = self.buckets.setdefault(key, deque())
            self.buckets.move_to_end(key)
            while bucket and bucket[0] <= now - seconds:
                bucket.popleft()
            if len(bucket) >= maximum:
                raise APIError(
                    429,
                    "rate_limited",
                    "Too many requests. Give this workspace a moment, then try again.",
                    max(1, math.ceil(seconds - (now - bucket[0]))),
                )
            bucket.append(now)
            while len(self.buckets) > 2048:
                self.buckets.popitem(last=False)


class RequestSafety:
    def __init__(self, app, config):
        self.app = app
        self.config = config
        self.active = 0
        self.rates = RateLimits()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def secured_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-frame-options", b"DENY"),
                    ]
                )
                message = {**message, "headers": headers}
            await send(message)

        try:
            if self.active >= 16:
                raise APIError(
                    503, "busy", "The study service is busy. Please retry shortly.", 3
                )
            headers = dict(scope.get("headers", []))
            if sum(len(k) + len(v) for k, v in scope.get("headers", [])) > 16384:
                raise APIError(
                    431, "headers_too_large", "The request headers are too large."
                )
            origin = headers.get(b"origin", b"").decode("latin1")
            if origin and origin not in self.config.origins:
                raise APIError(
                    403,
                    "origin_denied",
                    "This website is not allowed to access the study service.",
                )
            peer = (scope.get("client") or ("unknown", 0))[0]
            self.rates.check(("peer", peer), 300)
            limit = (
                self.config.max_upload_bytes
                if scope["path"] == "/api/documents" and scope["method"] == "POST"
                else 65536
            )
            length = headers.get(b"content-length")
            if length is not None:
                if not length.isdigit():
                    raise APIError(
                        400, "invalid_length", "The request size is invalid."
                    )
                if len(length) > 12 or int(length) > limit:
                    raise APIError(
                        413,
                        "request_too_large",
                        "This request is too large. Files must be 10 MiB or smaller.",
                    )
            self.active += 1
            try:
                body = bytearray()
                deadline = time.monotonic() + 30
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise APIError(
                            408,
                            "upload_timeout",
                            "The upload took too long. Check your connection and retry.",
                        )
                    message = await asyncio.wait_for(receive(), timeout=remaining)
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > limit:
                        raise APIError(
                            413,
                            "request_too_large",
                            "This request is too large. Files must be 10 MiB or smaller.",
                        )
                    if not message.get("more_body", False):
                        break
                delivered = False

                async def replay():
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {
                            "type": "http.request",
                            "body": bytes(body),
                            "more_body": False,
                        }
                    return await receive()

                await self.app(scope, replay, secured_send)
            finally:
                self.active -= 1
        except (APIError, asyncio.TimeoutError) as error:
            public = (
                error
                if isinstance(error, APIError)
                else APIError(
                    408, "upload_timeout", "The upload took too long. Please retry."
                )
            )
            if not started:
                response = JSONResponse(
                    public.payload(),
                    status_code=public.status,
                    headers=(
                        {"Retry-After": str(public.retry_after)}
                        if public.retry_after
                        else None
                    ),
                )
                await response(scope, receive, secured_send)
        except Exception:
            # Do not log exception values: provider/parser diagnostics may contain note text.
            logging.getLogger("padhai.api").error(
                "A request failed; private exception details suppressed."
            )
            if not started:
                await JSONResponse(
                    APIError(
                        500,
                        "internal_error",
                        "Something went wrong. Your workspace is still protected; please retry.",
                    ).payload(),
                    status_code=500,
                )(scope, receive, secured_send)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Preferences(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    result_limit: int = Field(ge=1, le=10)
    ai_consent: bool


class SearchInput(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=5, ge=1, le=10)


class QuizInput(StrictModel):
    count: Literal[5, 10, 20] = 5
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    @field_validator("count", mode="before")
    @classmethod
    def integer_count(cls, value):
        if type(value) is not int:
            raise ValueError("Question count must be an integer.")
        return value


class Submission(StrictModel):
    attempt_number: int = Field(ge=1, le=20)
    answers: list[int | None] = Field(min_length=1, max_length=20)


class SampleInput(StrictModel):
    sample: Literal["dbms", "cloud"]


def create_app(config: APIConfig | None = None, *, service_factory=StudyService):
    config = config or APIConfig.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.service = service_factory(config)
        app.state.rates = RateLimits()

        async def cleanup():
            while True:
                await asyncio.sleep(30)
                await run_in_threadpool(app.state.service.sweep)

        task = asyncio.create_task(cleanup())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            await run_in_threadpool(app.state.service.close)

    app = FastAPI(
        title="PadhAI study API",
        version="0.2.0",
        lifespan=lifespan,
        docs_url=None if config.secure_cookie else "/docs",
        redoc_url=None,
        openapi_url=None if config.secure_cookie else "/openapi.json",
    )
    app.add_middleware(RequestSafety, config=config)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "X-PadhAI-CSRF",
            "X-File-Name",
            "X-Requested-With",
        ],
        expose_headers=["Retry-After"],
        max_age=600,
    )

    @app.exception_handler(APIError)
    async def public_error(request, error):
        return JSONResponse(
            error.payload(),
            status_code=error.status,
            headers=(
                {"Retry-After": str(error.retry_after)} if error.retry_after else None
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # FastAPI's default errors can echo invalid input. Return only field names.
        fields = sorted({str(e["loc"][-1]) for e in error.errors() if e.get("loc")})
        return JSONResponse(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "Check the request fields and try again.",
                    "fields": fields,
                }
            },
            status_code=422,
        )

    def service(request: Request):
        return request.app.state.service

    def origin_check(request):
        if (
            request.headers.get("origin") not in config.origins
            or request.headers.get("x-requested-with") != "padhai"
        ):
            raise APIError(
                403,
                "origin_required",
                "Open PadhAI from its approved website to continue.",
            )

    def owner(request: Request, study: StudyService = Depends(service)):
        token = request.cookies.get(config.cookie_name)
        workspace = study.authenticate(token)
        request.app.state.rates.check(("workspace", workspace["id"]), 240)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin_check(request)
            supplied = request.headers.get("x-padhai-csrf", "")
            if len(supplied) != 64 or not hmac.compare_digest(
                supplied, csrf_token(token)
            ):
                raise APIError(
                    403,
                    "session_changed",
                    "Your workspace session changed. Reload the page before trying again.",
                )
            request.app.state.rates.check(("write", workspace["id"]), 40)
        return workspace["id"]

    def session_response(study, token, workspace):
        response = JSONResponse(
            {
                "workspace": study.snapshot(workspace["id"]),
                "csrf_token": csrf_token(token),
            }
        )
        response.set_cookie(
            config.cookie_name,
            token,
            max_age=max(1, int(workspace["expires_at"] - study.clock())),
            httponly=True,
            secure=config.secure_cookie,
            samesite="lax",
            path="/",
        )
        return response

    @app.get("/api/health")
    def health(study: StudyService = Depends(service)):
        study.db.one("SELECT 1")
        return {"status": "ok", "version": "0.2.0"}

    @app.post("/api/session")
    def start_session(request: Request, study: StudyService = Depends(service)):
        origin_check(request)
        token = request.cookies.get(config.cookie_name)
        try:
            workspace = study.authenticate(token)
        except APIError as error:
            if error.status != 401:
                raise
            peer = request.client.host if request.client else "unknown"
            request.app.state.rates.check(("new_workspace", peer), 6, seconds=600)
            token, workspace = study.create()
        return session_response(study, token, workspace)

    @app.get("/api/session")
    def get_session(
        request: Request,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return {
            "workspace": study.snapshot(workspace_id),
            "csrf_token": csrf_token(request.cookies[config.cookie_name]),
        }

    @app.delete("/api/session", status_code=204)
    def delete_session(
        workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        study.destroy(workspace_id)
        response = Response(status_code=204)
        response.delete_cookie(
            config.cookie_name,
            path="/",
            httponly=True,
            secure=config.secure_cookie,
            samesite="lax",
        )
        return response

    @app.get("/api/workspace")
    def get_workspace(
        workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        return study.snapshot(workspace_id)

    @app.patch("/api/workspace")
    def update_workspace(
        body: Preferences,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.settings(
            workspace_id, body.name, body.result_limit, body.ai_consent
        )

    @app.get("/api/documents")
    def list_documents(
        workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        return {"documents": study.snapshot(workspace_id)["documents"]}

    @app.post("/api/documents", status_code=201)
    async def upload_document(
        request: Request,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        supplied = request.headers.get("x-file-name", "")
        if not supplied or len(supplied) > 2400:
            raise APIError(
                422,
                "filename_required",
                "Choose a PDF, TXT, or Markdown file with a valid filename.",
            )
        try:
            filename = unquote_to_bytes(supplied).decode("utf-8", errors="strict")
        except (UnicodeError, ValueError):
            raise APIError(
                422, "invalid_filename", "The filename must use valid UTF-8 text."
            ) from None
        if any(character in filename for character in ("/", "\\", "\x00")):
            raise APIError(
                422,
                "invalid_filename",
                "Use a filename without directory paths or control characters.",
            )
        body = await request.body()
        if not body:
            raise APIError(
                422,
                "empty_file",
                "This file is empty. Choose a document that contains text.",
            )
        return await run_in_threadpool(study.add_document, workspace_id, filename, body)

    @app.post("/api/documents/sample", status_code=201)
    async def add_sample(
        body: SampleInput,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        filename = {"dbms": "dbms_notes.pdf", "cloud": "cloud_computing.txt"}[
            body.sample
        ]
        path = Path(__file__).resolve().parents[1] / "sample_data" / filename
        return await run_in_threadpool(
            study.add_document, workspace_id, filename, path.read_bytes()
        )

    @app.get("/api/documents/{document_id}")
    def document_preview(
        document_id: str,
        page: int = Query(default=0, ge=0, le=299),
        offset: int = Query(default=0, ge=0, le=1_000_000),
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.get_document(workspace_id, document_id, page, offset)

    @app.delete("/api/documents/{document_id}", status_code=204)
    def delete_document(
        document_id: str,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        study.delete_document(workspace_id, document_id)
        return Response(status_code=204)

    @app.delete("/api/documents", status_code=204)
    def clear_documents(
        workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        study.clear_notes(workspace_id)
        return Response(status_code=204)

    @app.post("/api/index", status_code=202)
    def build_index(
        workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        return study.submit_job(workspace_id, "index")

    @app.get("/api/jobs/{job_id}")
    def get_job(
        job_id: str, workspace_id=Depends(owner), study: StudyService = Depends(service)
    ):
        return study.get_job(workspace_id, job_id)

    @app.post("/api/search")
    def search(
        body: SearchInput,
        request: Request,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        request.app.state.rates.check(("search", workspace_id), 20)
        return study.search(workspace_id, body.question, body.limit)

    @app.post("/api/answers", status_code=202)
    def answer(
        body: SearchInput,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        if not body.question.strip():
            raise APIError(
                422, "empty_question", "Enter a question before generating an answer."
            )
        return study.submit_job(workspace_id, "answer", body.model_dump())

    @app.get("/api/quizzes")
    def quizzes(workspace_id=Depends(owner), study: StudyService = Depends(service)):
        return {"quizzes": study.list_quizzes(workspace_id)}

    @app.post("/api/quizzes", status_code=202)
    def generate_quiz(
        body: QuizInput,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.submit_job(workspace_id, "quiz", body.model_dump())

    @app.get("/api/quizzes/{quiz_id}")
    def get_quiz(
        quiz_id: str,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.get_quiz(workspace_id, quiz_id)

    @app.post("/api/quizzes/{quiz_id}/submit")
    def submit_quiz(
        quiz_id: str,
        body: Submission,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.submit_quiz(
            workspace_id, quiz_id, body.attempt_number, body.answers
        )

    @app.post("/api/quizzes/{quiz_id}/retake")
    def retake_quiz(
        quiz_id: str,
        workspace_id=Depends(owner),
        study: StudyService = Depends(service),
    ):
        return study.retake(workspace_id, quiz_id)

    return app


app = create_app()
