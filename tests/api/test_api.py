"""HTTP ownership and lifecycle contracts; real SQLite, Chroma and core validators."""

from dataclasses import replace
from pathlib import Path
from threading import Event
import json
import time

import pytest
from fastapi.testclient import TestClient

from api.config import APIConfig
from api.errors import APIError
from api.main import create_app, RateLimits
from api.parser import parse_upload
from api.service import StudyService
from src.config import Settings
from src.document_loader import load_document
from src.retriever import SearchEngine
from src.answer_generator import Citation, AnswerResult
from src.quiz_generator import QuizQuestion, QuizResult

ORIGIN = "http://localhost:5173"
NOTE = b"Database normalization reduces redundancy and improves data integrity."


class TopicEmbedder:
    model_id = "api-test-topics@v1"

    def embed(self, texts):
        return [
            (
                [1.0, 0.0, 0.0]
                if "database" in text.lower()
                else [0.0, 1.0, 0.0] if "cloud" in text.lower() else [0.0, 0.0, 1.0]
            )
            for text in texts
        ]


def quiz_fixture(chunks, count, difficulty, settings):
    citation = Citation("S1", chunks[0], chunks[0].text)
    questions = tuple(
        QuizQuestion(
            f"Practice question {i+1}",
            ("Redundancy", "Latency", "Bandwidth", "Availability"),
            0,
            "The supplied source describes redundancy.",
            (citation,),
        )
        for i in range(count)
    )
    return QuizResult("generated", "Practice ready.", questions)


@pytest.fixture
def app_client(tmp_path):
    config = APIConfig(
        database_path=tmp_path / "private" / "study.sqlite3",
        paid_ai_enabled=True,
        core=Settings(openai_api_key="test-only-not-a-real-key"),
    )
    app = create_app(
        config,
        service_factory=lambda c: StudyService(
            c,
            parser=load_document,
            engine_factory=lambda: SearchEngine(embedder=TopicEmbedder()),
            quiz_fn=quiz_fixture,
        ),
    )
    with TestClient(app) as client:
        yield client, app.state.service


def session(client):
    response = client.post(
        "/api/session", headers={"Origin": ORIGIN, "X-Requested-With": "padhai"}
    )
    assert response.status_code == 200, response.text
    client.headers.update(
        {
            "Origin": ORIGIN,
            "X-Requested-With": "padhai",
            "X-PadhAI-CSRF": response.json()["csrf_token"],
        }
    )
    return response.json()["workspace"]


def upload(client, body=NOTE, name="notes.txt"):
    return client.post(
        "/api/documents",
        content=body,
        headers={"X-File-Name": name, "Content-Type": "application/octet-stream"},
    )


def wait_job(client, job):
    assert job.status_code == 202, job.text
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = client.get("/api/jobs/" + job.json()["id"])
        assert response.status_code == 200, response.text
        if response.json()["status"] in {"completed", "failed"}:
            return response.json()
        time.sleep(0.01)
    pytest.fail("Background job did not finish")


def consent(client, enabled=True):
    response = client.patch(
        "/api/workspace",
        json={"name": "Study space", "result_limit": 3, "ai_consent": enabled},
    )
    assert response.status_code == 200


def test_complete_upload_index_search_and_source(app_client):
    client, service = app_client
    workspace = session(client)
    created = upload(client).json()["document"]
    assert created["filename"] == "notes.txt"
    assert client.post("/api/search", json={"question": "database"}).status_code == 409
    indexed = wait_job(client, client.post("/api/index"))
    assert indexed["status"] == "completed"
    assert indexed["result"]["indexed_chunks"] == 1
    result = client.post("/api/search", json={"question": "database"}).json()
    assert result["passages"][0]["document_id"] == created["id"]
    assert result["passages"][0]["text"] == NOTE.decode()
    assert (
        client.post("/api/search", json={"question": "unrelated"}).json()["mode"]
        == "no_evidence"
    )
    preview = client.get("/api/documents/" + created["id"]).json()
    assert preview["page"]["text"] == NOTE.decode()
    assert client.get("/api/documents/" + created["id"] + "?page=1").status_code == 404
    assert (
        client.get("/api/documents/" + created["id"] + "?offset=999").status_code == 404
    )
    assert (
        service.authenticate(client.cookies.get("padhai_workspace"))["id"]
        == workspace["id"]
    )


def test_isolation_and_no_client_workspace_override(app_client):
    client, service = app_client
    one = session(client)
    doc = upload(client).json()["document"]
    job = wait_job(client, client.post("/api/index"))
    consent(client)
    quiz_job = wait_job(
        client, client.post("/api/quizzes", json={"count": 5, "difficulty": "easy"})
    )
    quiz_id = quiz_job["result"]["quiz_id"]
    client.cookies.clear()
    two = session(client)
    assert one["id"] != two["id"]
    assert client.get("/api/documents").json()["documents"] == []
    for path in [
        f'/api/documents/{doc["id"]}',
        f'/api/jobs/{job["id"]}',
        f"/api/quizzes/{quiz_id}",
    ]:
        assert client.get(path).status_code == 404
    assert client.delete(f'/api/documents/{doc["id"]}').status_code == 404
    assert (
        client.post(
            f"/api/quizzes/{quiz_id}/submit",
            json={"attempt_number": 1, "answers": [0] * 5},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/search", json={"question": "database", "workspace_id": one["id"]}
        ).status_code
        == 422
    )
    assert client.get("/api/workspace").json()["stats"]["documents"] == 0


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "https://evil.example", "X-Requested-With": "padhai"},
        {"Origin": ORIGIN},
    ],
)
def test_bootstrap_requires_origin_and_custom_header(app_client, headers):
    client, _ = app_client
    assert client.post("/api/session", headers=headers).status_code == 403


def test_csrf_cors_cookie_and_private_cache_headers(app_client):
    client, service = app_client
    response = client.post(
        "/api/session", headers={"Origin": ORIGIN, "X-Requested-With": "padhai"}
    )
    assert (
        "HttpOnly" in response.headers["set-cookie"]
        and "SameSite=lax" in response.headers["set-cookie"]
    )
    client.headers.update({"Origin": ORIGIN, "X-Requested-With": "padhai"})
    assert upload(client).status_code == 403
    client.headers["X-PadhAI-CSRF"] = "0" * 64
    assert upload(client).status_code == 403
    client.headers["X-PadhAI-CSRF"] = response.json()["csrf_token"]
    assert upload(client).status_code == 201
    assert (
        client.get(
            "/api/workspace", headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    cors = client.options(
        "/api/documents",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-PadhAI-CSRF,X-File-Name",
        },
    )
    assert (
        cors.status_code == 200
        and cors.headers["access-control-allow-origin"] == ORIGIN
    )
    assert cors.headers["access-control-allow-credentials"] == "true"
    response = client.get("/api/workspace")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert service.config.core.openai_api_key not in response.text
    raw = client.cookies.get("padhai_workspace")
    assert raw not in json.dumps(service.db.all("SELECT * FROM workspaces"))


def test_production_secure_cookie_and_no_openapi(tmp_path):
    config = APIConfig(
        database_path=tmp_path / "prod.sqlite3",
        origins=("https://study.example",),
        secure_cookie=True,
    )
    with TestClient(create_app(config), base_url="https://study.example") as client:
        response = client.post(
            "/api/session",
            headers={"Origin": "https://study.example", "X-Requested-With": "padhai"},
        )
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert (
            "__Host-padhai_workspace=" in cookie
            and "Secure" in cookie
            and "Domain=" not in cookie
        )
        assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize(
    "body,name",
    [
        (b"", "notes.txt"),
        (b"\xff", "notes.txt"),
        (b"no pdf", "notes.pdf"),
        (NOTE, "notes.exe"),
        (NOTE, "..%2Fsecret.txt"),
        (NOTE, "%FF.txt"),
    ],
)
def test_invalid_uploads_never_create_documents(app_client, body, name):
    client, _ = app_client
    session(client)
    assert upload(client, body, name).status_code == 422
    assert client.get("/api/documents").json()["documents"] == []


def test_limits_duplicate_and_revision_invalidation(app_client):
    client, service = app_client
    session(client)
    first = upload(client).json()["document"]
    wait_job(client, client.post("/api/index"))
    revision = client.get("/api/workspace").json()["revision"]
    assert upload(client, NOTE, "renamed.txt").json()["status"] == "duplicate"
    current = client.get("/api/workspace").json()
    assert current["revision"] == revision and current["index"]["status"] == "ready"
    service.config = replace(service.config, max_documents=1)
    assert upload(client, b"Cloud computing is useful.", "cloud.txt").status_code == 409
    assert client.get("/api/workspace").json()["index"]["status"] == "ready"
    assert client.delete("/api/documents/" + first["id"]).status_code == 204
    assert client.post("/api/search", json={"question": "database"}).status_code == 409
    assert client.get("/api/workspace").json()["stats"]["documents"] == 0


def test_input_limits_and_errors_do_not_echo_private_values(app_client):
    client, _ = app_client
    session(client)
    secret = "PRIVATE-NOTE-TEXT"
    response = client.post("/api/search", json={"question": {"secret": secret}})
    assert response.status_code == 422 and secret not in response.text
    for payload in [
        {"question": "q", "limit": True},
        {"question": "q", "limit": 11},
        {"question": "q" * 2001},
        {"question": 123},
    ]:
        assert client.post("/api/search", json=payload).status_code == 422
    assert client.post("/api/quizzes", json={"count": True}).status_code == 422
    assert client.post("/api/workspace", content=b"x" * 65537).status_code == 413
    assert (
        client.post(
            "/api/documents", content=b"x", headers={"Content-Length": "10485761"}
        ).status_code
        == 413
    )


def test_quiz_private_answers_scoring_idempotency_and_retake(app_client):
    client, service = app_client
    session(client)
    upload(client)
    assert (
        client.post("/api/quizzes", json={}).json()["error"]["code"]
        == "consent_required"
    )
    consent(client)
    job = wait_job(
        client, client.post("/api/quizzes", json={"count": 5, "difficulty": "hard"})
    )
    assert job["status"] == "completed", job
    quiz_id = job["result"]["quiz_id"]
    path = "/api/quizzes/" + quiz_id
    draft = client.get(path).json()
    assert draft["answers"] is None and draft["score"] is None
    assert all(set(q) == {"question", "options"} for q in draft["questions"])
    assert "correct_index" not in client.get("/api/quizzes").text
    assert client.post(path + "/retake").status_code == 409
    assert (
        client.post(
            path + "/submit", json={"attempt_number": 1, "answers": [9] * 5}
        ).status_code
        == 422
    )
    payload = {"attempt_number": 1, "answers": [0, 1, None, 0, 2]}
    response = client.post(path + "/submit", json=payload)
    assert response.status_code == 200, response.text
    completed = response.json()
    assert completed["score"]["correct"] == 2 and completed["score"]["unanswered"] == 1
    assert completed["questions"][0]["correct_index"] == 0
    assert completed["questions"][0]["citations"][0]["quote"] == NOTE.decode()
    assert client.post(path + "/submit", json=payload).json() == completed
    assert (
        client.post(
            path + "/submit", json={"attempt_number": 1, "answers": [0] * 5}
        ).status_code
        == 409
    )
    retake = client.post(path + "/retake").json()
    assert retake["attempt_number"] == 2 and not retake["submitted"]
    assert "correct_index" not in json.dumps(retake)
    assert client.post(path + "/submit", json=payload).status_code == 409
    upload(client, b"Cloud computing delivers services.", "cloud.txt")
    assert (
        client.get(path).status_code == 200
    )  # Adding a note preserves existing source material.
    client.delete("/api/documents")
    assert client.get(path).status_code == 404
    assert service.db.one("SELECT COUNT(*) AS count FROM attempts")["count"] == 0


def test_ai_disabled_and_daily_allowances(app_client):
    client, service = app_client
    session(client)
    upload(client)
    consent(client)
    service.config = replace(service.config, paid_ai_enabled=False)
    assert (
        client.post("/api/quizzes", json={}).json()["error"]["code"] == "ai_unavailable"
    )
    assert client.get("/api/workspace").json()["capabilities"]["ai_model"] is None
    service.config = replace(service.config, paid_ai_enabled=True, max_ai_per_day=1)
    assert (
        wait_job(client, client.post("/api/quizzes", json={}))["status"] == "completed"
    )
    assert client.post("/api/quizzes", json={}).status_code == 429
    assert (
        client.get("/api/workspace").json()["capabilities"]["ai_requests_remaining"]
        == 0
    )
    client.cookies.clear()
    session(client)
    upload(client)
    consent(client)
    assert client.post("/api/quizzes", json={}).status_code == 429


def test_expiry_and_deletion_remove_owned_data(app_client):
    client, service = app_client
    workspace = session(client)
    upload(client)
    consent(client)
    wait_job(client, client.post("/api/quizzes", json={}))
    original = service.clock
    service.clock = lambda: original() + service.config.workspace_ttl + 1
    assert client.get("/api/workspace").status_code == 401
    for table in ("workspaces", "documents", "jobs", "quizzes", "attempts", "events"):
        assert service.db.one(f"SELECT COUNT(*) AS count FROM {table}")["count"] == 0
    assert workspace["id"] not in service.runtimes
    service.clock = original
    session(client)
    upload(client)
    assert client.delete("/api/session").status_code == 204
    assert client.get("/api/session").status_code == 401


def test_inflight_index_cannot_publish_after_delete(app_client):
    client, service = app_client
    workspace = session(client)
    upload(client)
    entered, release = Event(), Event()

    class SlowEngine:
        cleared = False

        def build(self, chunks):
            entered.set()
            assert release.wait(5)
            return len(chunks)

        def clear(self):
            self.cleared = True

    engine = SlowEngine()
    service.engine_factory = lambda: engine
    job = client.post("/api/index")
    assert entered.wait(2)
    assert client.post("/api/index").status_code == 409
    client.delete("/api/session")
    release.set()
    service.executor.shutdown(wait=True)
    assert engine.cleared
    assert workspace["id"] not in service.runtimes
    assert service.db.one("SELECT COUNT(*) AS count FROM jobs")["count"] == 0


def test_unexpected_job_error_is_safe(app_client):
    client, service = app_client
    session(client)
    upload(client)

    def fail():
        raise RuntimeError("SECRET-KEY and PRIVATE-NOTES")

    service.engine_factory = fail
    job = wait_job(client, client.post("/api/index"))
    assert job["status"] == "failed" and "SECRET" not in json.dumps(job)
    assert job["error"]["code"] == "processing_failed"


def test_restart_keeps_notes_but_requires_reindex(tmp_path):
    config = APIConfig(database_path=tmp_path / "restart.sqlite3")
    first = StudyService(
        config,
        parser=load_document,
        engine_factory=lambda: SearchEngine(embedder=TopicEmbedder()),
    )
    token, workspace = first.create()
    first.add_document(workspace["id"], "notes.txt", NOTE)
    first.close()
    second = StudyService(config)
    try:
        assert second.authenticate(token)["id"] == workspace["id"]
        assert second.snapshot(workspace["id"])["stats"]["documents"] == 1
        assert second.snapshot(workspace["id"])["index"]["status"] == "not_indexed"
    finally:
        second.close()


def test_actual_parser_handles_pdf_text_and_invalid_file():
    pdf = Path("sample_data/dbms_notes.pdf").read_bytes()
    parsed = parse_upload("dbms_notes.pdf", pdf)
    assert len(parsed.pages) == 2 and parsed.pages[0].page_number == 1
    assert parse_upload("notes.txt", NOTE).pages[0].text == NOTE.decode()
    with pytest.raises(APIError):
        parse_upload("bad.pdf", b"not a pdf")


def test_rate_limits_retry_after_and_recovery():
    clock = [0.0]
    rates = RateLimits(clock=lambda: clock[0])
    rates.check(("owner", "one"), 1)
    with pytest.raises(APIError) as error:
        rates.check(("owner", "one"), 1)
    assert error.value.retry_after == 60
    rates.check(("owner", "two"), 1)
    clock[0] = 60
    rates.check(("owner", "one"), 1)


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://*.example.com",
        "http://evil.example",
        "https://user:pass@example.com",
        "https://example.com/path",
        "https://example.com?token=secret",
    ],
)
def test_production_origin_config_rejects_unsafe_origins(monkeypatch, origin):
    monkeypatch.setenv("API_ENV", "production")
    monkeypatch.setenv("API_ALLOWED_ORIGINS", origin)
    with pytest.raises(ValueError):
        APIConfig.from_env()


def test_zero_global_ai_allowance_blocks_first_request(app_client):
    client, service = app_client
    session(client)
    upload(client)
    consent(client)
    service.config = replace(service.config, max_ai_per_day=0)
    assert client.post("/api/quizzes", json={}).status_code == 429
    assert service.db.one("SELECT COUNT(*) AS count FROM jobs")["count"] == 0


def test_repeated_cleanup_is_idempotent(app_client):
    client, service = app_client
    workspace = session(client)
    upload(client)
    service.destroy(workspace["id"])
    service.destroy(workspace["id"])
    service.sweep()
    assert workspace["id"] not in service.runtimes


def test_deleted_filename_is_removed_from_activity(app_client):
    client, _ = app_client
    session(client)
    doc = upload(client, name="private-title.txt").json()["document"]
    client.delete("/api/documents/" + doc["id"])
    assert "private-title.txt" not in client.get("/api/workspace").text


def test_real_body_size_is_bounded_even_without_declared_length(app_client):
    client, _ = app_client
    session(client)

    def chunks():
        yield b"a" * 40000
        yield b"a" * 40000

    assert client.post("/api/search", content=chunks()).status_code == 413


def test_preview_continuations_do_not_truncate_long_notes(app_client):
    client, _ = app_client
    session(client)
    content = ("Database notes. " * 1100).encode()
    doc = upload(client, content).json()["document"]
    one = client.get("/api/documents/" + doc["id"]).json()["page"]
    two = client.get("/api/documents/" + doc["id"] + "?offset=12000").json()["page"]
    assert one["truncated"] and not two["truncated"]
    assert one["text"] + two["text"] == content.decode()


def test_answer_generation_uses_only_server_retrieved_sources(app_client):
    from src.answer_generator import AnswerClaim

    client, service = app_client
    session(client)
    upload(client)
    consent(client)
    wait_job(client, client.post("/api/index"))
    seen = []

    def grounded_answer(question, hits, settings):
        seen.extend(hits)
        citation = Citation("S1", hits[0].chunk, hits[0].chunk.text)
        return AnswerResult(
            "grounded",
            "Answer ready.",
            (AnswerClaim("Normalization reduces redundancy.", (citation,)),),
        )

    service.answer_fn = grounded_answer
    response = client.post(
        "/api/answers",
        json={"question": "database", "limit": 3, "sources": ["forged evidence"]},
    )
    assert response.status_code == 422
    job = wait_job(
        client, client.post("/api/answers", json={"question": "database", "limit": 3})
    )
    assert job["status"] == "completed" and seen[0].chunk.text == NOTE.decode()
    assert job["result"]["claims"][0]["citations"][0]["quote"] == NOTE.decode()
    assert "test-only-not-a-real-key" not in json.dumps(job)


@pytest.mark.parametrize("count", [5.0, "5", True, 0, 6, 21])
def test_quiz_count_is_a_strict_supported_integer(app_client, count):
    client, _ = app_client
    session(client)
    assert client.post("/api/quizzes", json={"count": count}).status_code == 422
