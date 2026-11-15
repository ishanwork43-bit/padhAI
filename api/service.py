"""Workspace ownership, durable metadata, and bounded asynchronous study jobs."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from threading import RLock, BoundedSemaphore
from uuid import uuid4
import json
import secrets
import time

from api.config import APIConfig
from api.database import Database
from api.errors import APIError
from api.parser import parse_upload
from src.document_loader import Document, Page, DocumentError, _filename
from src.chunker import Chunk, chunk_document
from src.embeddings import LocalEmbedder, EmbeddingError
from src.retriever import SearchEngine, RetrievalError
from src.answer_generator import Citation, generate_answer
from src.quiz_generator import (
    QuizQuestion,
    generate_quiz,
    score_quiz,
    QuizValidationError,
)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def csrf_token(raw_token):
    return sha256(("padhai-csrf:" + raw_token).encode()).hexdigest()


def citation_json(citation):
    chunk = citation.chunk
    return {
        "source_id": citation.source_id,
        "document_id": chunk.document_id,
        "filename": chunk.filename,
        "page_number": chunk.page_number,
        "start_char": chunk.start_char,
        "end_char": chunk.end_char,
        "quote": citation.quote,
    }


def passage_json(hit):
    return {**asdict(hit.chunk), "similarity": hit.similarity}


@dataclass
class Runtime:
    lock: RLock = field(default_factory=RLock)
    engine: SearchEngine | None = None
    revision: int = -1


class StudyService:
    def __init__(
        self,
        config: APIConfig,
        *,
        clock=time.time,
        parser=parse_upload,
        engine_factory=None,
        answer_fn=generate_answer,
        quiz_fn=generate_quiz,
    ):
        self.config = config
        self.clock = clock
        self.db = Database(config.database_path)
        self.parser = parser
        self.engine_factory = engine_factory or (
            lambda: SearchEngine(embedder=LocalEmbedder())
        )
        self.answer_fn = answer_fn
        self.quiz_fn = quiz_fn
        self.registry_lock = RLock()
        self.runtimes: dict[str, Runtime] = {}
        self.retired_engines = []
        self.job_slots = BoundedSemaphore(config.max_jobs)
        self.index_slot = BoundedSemaphore(1)
        self.executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="padhai-jobs"
        )
        self.closed = False
        self.sweep()

    def runtime(self, workspace_id):
        with self.registry_lock:
            if workspace_id not in self.runtimes and not self.db.one(
                "SELECT id FROM workspaces WHERE id=?", (workspace_id,)
            ):
                raise APIError(
                    401,
                    "workspace_expired",
                    "This workspace has expired or was deleted.",
                )
            return self.runtimes.setdefault(workspace_id, Runtime())

    def workspace(self, workspace_id):
        row = self.db.one("SELECT * FROM workspaces WHERE id=?", (workspace_id,))
        if row is None or row["expires_at"] <= self.clock():
            if row:
                self.destroy(workspace_id)
            raise APIError(
                401,
                "workspace_expired",
                "This workspace has expired or was deleted. Start a new workspace to continue.",
            )
        return row

    def authenticate(self, token):
        if not isinstance(token, str) or not 30 <= len(token) <= 100:
            raise APIError(401, "no_workspace", "Start a workspace to continue.")
        row = self.db.one(
            "SELECT id FROM workspaces WHERE token_hash=?",
            (sha256(token.encode()).hexdigest(),),
        )
        if row is None:
            raise APIError(
                401,
                "no_workspace",
                "This workspace is no longer available. Start a new workspace.",
            )
        return self.workspace(row["id"])

    def create(self):
        self.sweep()
        now = self.clock()
        token = secrets.token_urlsafe(32)
        workspace_id = uuid4().hex
        with self.db.transaction() as conn:
            if (
                conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
                >= self.config.max_workspaces
            ):
                raise APIError(
                    503,
                    "capacity",
                    "All workspace slots are in use. Please try again later.",
                    60,
                )
            conn.execute(
                "INSERT INTO workspaces(id,token_hash,name,created_at,expires_at) VALUES(?,?,?,?,?)",
                (
                    workspace_id,
                    sha256(token.encode()).hexdigest(),
                    "My workspace",
                    now,
                    now + self.config.workspace_ttl,
                ),
            )
        return token, self.workspace(workspace_id)

    def event(self, conn, workspace_id, kind, label):
        conn.execute(
            "INSERT INTO events(workspace_id,kind,label,created_at) VALUES(?,?,?,?)",
            (workspace_id, kind, label, self.clock()),
        )
        conn.execute(
            "DELETE FROM events WHERE workspace_id=? AND id NOT IN "
            "(SELECT id FROM events WHERE workspace_id=? ORDER BY id DESC LIMIT 40)",
            (workspace_id, workspace_id),
        )

    def clear_engine(self, engine):
        if engine is not None:
            try:
                engine.clear()
            except RetrievalError:
                with self.registry_lock:
                    if engine not in self.retired_engines:
                        self.retired_engines.append(engine)

    def detach(self, workspace_id):
        state = self.runtime(workspace_id)
        engine, state.engine = state.engine, None
        state.revision = -1
        self.clear_engine(engine)

    def invalidate(self, conn, workspace_id, clear_quizzes=True):
        conn.execute(
            "UPDATE workspaces SET revision=revision+1 WHERE id=?", (workspace_id,)
        )
        if clear_quizzes:
            conn.execute("DELETE FROM quizzes WHERE workspace_id=?", (workspace_id,))
        else:
            # Adding notes preserves existing quizzes: their source documents are unchanged.
            conn.execute(
                "UPDATE quizzes SET revision=(SELECT revision FROM workspaces WHERE id=?) WHERE workspace_id=?",
                (workspace_id, workspace_id),
            )
        conn.execute("DELETE FROM jobs WHERE workspace_id=?", (workspace_id,))

    def destroy(self, workspace_id):
        # Cleanup and an explicit reset may race. Repeated deletion is harmless.
        with self.registry_lock:
            state = self.runtimes.get(workspace_id)
            if state is None:
                if not self.db.one(
                    "SELECT id FROM workspaces WHERE id=?", (workspace_id,)
                ):
                    return
                state = self.runtimes.setdefault(workspace_id, Runtime())
        with state.lock:
            with self.db.transaction() as conn:
                conn.execute("DELETE FROM workspaces WHERE id=?", (workspace_id,))
            engine, state.engine = state.engine, None
            state.revision = -1
            self.clear_engine(engine)
        with self.registry_lock:
            if self.runtimes.get(workspace_id) is state:
                self.runtimes.pop(workspace_id, None)
        self.db.checkpoint()

    def sweep(self):
        for row in self.db.all(
            "SELECT id FROM workspaces WHERE expires_at<=?", (self.clock(),)
        ):
            self.destroy(row["id"])
        with self.registry_lock:
            retired, self.retired_engines = self.retired_engines, []
        for engine in retired:
            self.clear_engine(engine)
        # Daily counters contain no study data and remain only seven days.
        cutoff = (
            datetime.fromtimestamp(self.clock() - 7 * 86400, timezone.utc)
            .date()
            .isoformat()
        )
        self.db.execute("DELETE FROM ai_usage WHERE day<?", (cutoff,))

    def document_rows(self, workspace_id):
        return self.db.all(
            "SELECT * FROM documents WHERE workspace_id=? ORDER BY created_at DESC, filename",
            (workspace_id,),
        )

    @staticmethod
    def document(row):
        return Document(
            row["id"],
            row["filename"],
            tuple(
                Page(p["text"], p["page_number"]) for p in json.loads(row["pages_json"])
            ),
            tuple(json.loads(row["warnings_json"])),
            row["byte_size"],
        )

    @staticmethod
    def metadata(row):
        return {
            "id": row["id"],
            "filename": row["filename"],
            "byte_size": row["byte_size"],
            "page_count": row["page_count"],
            "chunk_count": row["chunk_count"],
            "character_count": row["char_count"],
            "warnings": json.loads(row["warnings_json"]),
            "created_at": utc(row["created_at"]),
            "type": row["filename"].rsplit(".", 1)[-1].lower(),
        }

    def snapshot(self, workspace_id):
        state = self.runtime(workspace_id)
        with state.lock:
            workspace = self.workspace(workspace_id)
            docs = self.db.all(
                "SELECT id,filename,byte_size,page_count,chunk_count,char_count,warnings_json,created_at FROM documents WHERE workspace_id=? ORDER BY created_at DESC, filename",
                (workspace_id,),
            )
            active = self.db.one(
                "SELECT id,kind,status,phase FROM jobs WHERE workspace_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
                (workspace_id,),
            )
            ready = state.engine is not None and state.revision == workspace["revision"]
            quizzes = self.list_quizzes(workspace_id)
            completed = self.db.one(
                "SELECT COUNT(*) AS count FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE q.workspace_id=?",
                (workspace_id,),
            )["count"]
            today = (
                datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
            )
            usage = self.db.one("SELECT requests FROM ai_usage WHERE day=?", (today,))
            remaining = max(
                0,
                min(
                    self.config.max_ai_per_workspace - workspace["ai_requests"],
                    self.config.max_ai_per_day - (usage["requests"] if usage else 0),
                ),
            )
            return {
                "id": workspace_id,
                "name": workspace["name"],
                "revision": workspace["revision"],
                "created_at": utc(workspace["created_at"]),
                "expires_at": utc(workspace["expires_at"]),
                "settings": {
                    "result_limit": workspace["result_limit"],
                    "ai_consent": bool(workspace["ai_consent"]),
                },
                "capabilities": {
                    "semantic_search": True,
                    "ai_available": self.config.ai_available,
                    "ai_requests_remaining": (
                        remaining if self.config.ai_available else 0
                    ),
                    "ai_model": (
                        self.config.core.openai_model
                        if self.config.ai_available
                        else None
                    ),
                },
                "limits": {
                    "max_upload_bytes": self.config.max_upload_bytes,
                    "max_documents": self.config.max_documents,
                    "max_workspace_bytes": self.config.max_workspace_bytes,
                    "max_characters": self.config.max_workspace_characters,
                },
                "stats": {
                    "documents": len(docs),
                    "chunks": sum(d["chunk_count"] for d in docs),
                    "bytes": sum(d["byte_size"] for d in docs),
                    "characters": sum(d["char_count"] for d in docs),
                    "completed_quizzes": completed,
                },
                "index": {
                    "status": (
                        "ready"
                        if ready
                        else (
                            "indexing"
                            if active and active["kind"] == "index"
                            else "not_indexed" if docs else "empty"
                        )
                    ),
                    "indexed_chunks": (
                        sum(d["chunk_count"] for d in docs) if ready else 0
                    ),
                },
                "active_job": active,
                "documents": [self.metadata(d) for d in docs],
                "quizzes": quizzes,
                "activity": [
                    {**e, "created_at": utc(e["created_at"])}
                    for e in self.db.all(
                        "SELECT id,kind,label,created_at FROM events WHERE workspace_id=? ORDER BY id DESC LIMIT 8",
                        (workspace_id,),
                    )
                ],
            }

    def settings(self, workspace_id, name, result_limit, ai_consent):
        import unicodedata

        name = name.strip()
        if not name or any(unicodedata.category(c).startswith("C") for c in name):
            raise APIError(
                422,
                "invalid_name",
                "Use a workspace name without hidden or control characters.",
            )
        with self.runtime(workspace_id).lock:
            self.workspace(workspace_id)
            self.db.execute(
                "UPDATE workspaces SET name=?,result_limit=?,ai_consent=? WHERE id=?",
                (name, result_limit, int(ai_consent), workspace_id),
            )
        return self.snapshot(workspace_id)

    def add_document(self, workspace_id, filename, content):
        self.workspace(workspace_id)
        try:
            filename = _filename(filename)
        except DocumentError as error:
            raise APIError(422, "invalid_document", str(error)) from None
        if len(content) > self.config.max_upload_bytes:
            raise APIError(413, "file_too_large", "Files must be 10 MiB or smaller.")
        document_id = sha256(content).hexdigest()
        existing = self.db.one(
            "SELECT * FROM documents WHERE workspace_id=? AND id=?",
            (workspace_id, document_id),
        )
        if existing:
            return {"status": "duplicate", "document": self.metadata(existing)}
        try:
            document = self.parser(filename, content)
        except DocumentError as error:
            raise APIError(422, "invalid_document", str(error)) from None
        chunks = chunk_document(document)
        characters = sum(len(page.text) for page in document.pages)
        state = self.runtime(workspace_id)
        with state.lock:
            self.workspace(workspace_id)
            with self.db.transaction() as conn:
                existing = conn.execute(
                    "SELECT * FROM documents WHERE workspace_id=? AND id=?",
                    (workspace_id, document_id),
                ).fetchone()
                if existing:
                    return {
                        "status": "duplicate",
                        "document": self.metadata(dict(existing)),
                    }
                counts = conn.execute(
                    "SELECT COUNT(*),COALESCE(SUM(byte_size),0),COALESCE(SUM(char_count),0),COALESCE(SUM(chunk_count),0) FROM documents WHERE workspace_id=?",
                    (workspace_id,),
                ).fetchone()
                if (
                    counts[0] >= self.config.max_documents
                    or counts[1] + document.byte_size > self.config.max_workspace_bytes
                    or counts[2] + characters > self.config.max_workspace_characters
                    or counts[3] + len(chunks) > self.config.max_chunks
                ):
                    raise APIError(
                        409,
                        "workspace_limit",
                        "This workspace is full. Remove notes before adding more material.",
                    )
                total = conn.execute(
                    "SELECT COALESCE(SUM(char_count),0) FROM documents"
                ).fetchone()[0]
                if total + characters > self.config.max_total_characters:
                    raise APIError(
                        503,
                        "storage_capacity",
                        "The study service is at its storage limit. Please try again later.",
                        60,
                    )
                conn.execute(
                    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        workspace_id,
                        document.document_id,
                        document.filename,
                        document.byte_size,
                        encode([asdict(p) for p in document.pages]),
                        encode(document.warnings),
                        len(chunks),
                        len(document.pages),
                        characters,
                        self.clock(),
                    ),
                )
                self.invalidate(conn, workspace_id, clear_quizzes=False)
                self.event(conn, workspace_id, "upload", document.filename)
            self.detach(workspace_id)
            row = self.db.one(
                "SELECT * FROM documents WHERE workspace_id=? AND id=?",
                (workspace_id, document_id),
            )
            return {"status": "added", "document": self.metadata(row)}

    def get_document(self, workspace_id, document_id, page_index=0, offset=0):
        self.workspace(workspace_id)
        row = self.db.one(
            "SELECT * FROM documents WHERE workspace_id=? AND id=?",
            (workspace_id, document_id),
        )
        if row is None:
            raise APIError(
                404,
                "document_not_found",
                "This document is no longer in your workspace.",
            )
        document = self.document(row)
        if not 0 <= page_index < len(document.pages):
            raise APIError(
                404, "page_not_found", "That page does not exist in this document."
            )
        page = document.pages[page_index]
        if offset > len(page.text):
            raise APIError(
                404, "excerpt_not_found", "That excerpt is outside this page."
            )
        return {
            **self.metadata(row),
            "page": {
                "index": page_index,
                "page_number": page.page_number,
                "text": page.text[offset : offset + 12000],
                "offset": offset,
                "total_characters": len(page.text),
                "truncated": len(page.text) > offset + 12000,
            },
        }

    def delete_document(self, workspace_id, document_id):
        with self.runtime(workspace_id).lock:
            self.workspace(workspace_id)
            with self.db.transaction() as conn:
                row = conn.execute(
                    "SELECT filename FROM documents WHERE workspace_id=? AND id=?",
                    (workspace_id, document_id),
                ).fetchone()
                if row is None:
                    raise APIError(
                        404,
                        "document_not_found",
                        "This document is no longer in your workspace.",
                    )
                conn.execute(
                    "DELETE FROM documents WHERE workspace_id=? AND id=?",
                    (workspace_id, document_id),
                )
                self.invalidate(conn, workspace_id)
                conn.execute(
                    "DELETE FROM events WHERE workspace_id=? AND label=?",
                    (workspace_id, row["filename"]),
                )
                self.event(conn, workspace_id, "delete", "A document was removed")
            self.detach(workspace_id)
        self.db.checkpoint()

    def clear_notes(self, workspace_id):
        with self.runtime(workspace_id).lock:
            self.workspace(workspace_id)
            with self.db.transaction() as conn:
                conn.execute(
                    "DELETE FROM documents WHERE workspace_id=?", (workspace_id,)
                )
                conn.execute("DELETE FROM events WHERE workspace_id=?", (workspace_id,))
                self.invalidate(conn, workspace_id)
            self.detach(workspace_id)
        self.db.checkpoint()

    def get_job(self, workspace_id, job_id):
        self.workspace(workspace_id)
        row = self.db.one(
            "SELECT * FROM jobs WHERE id=? AND workspace_id=?", (job_id, workspace_id)
        )
        if row is None:
            raise APIError(
                404,
                "job_not_found",
                "This operation is no longer available. Your notes may have changed.",
            )
        return {
            "id": row["id"],
            "kind": row["kind"],
            "status": row["status"],
            "phase": row["phase"],
            "revision": row["revision"],
            "created_at": utc(row["created_at"]),
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
        }

    def _reserve_ai(self, conn, workspace):
        if not self.config.ai_available:
            raise APIError(
                409,
                "ai_unavailable",
                "AI generation is not enabled on this server. Semantic search is available without an API key.",
            )
        if not workspace["ai_consent"]:
            raise APIError(
                409,
                "consent_required",
                "Enable AI for this workspace in Settings before sending excerpts to the provider.",
            )
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        count = conn.execute(
            "SELECT requests FROM ai_usage WHERE day=?", (day,)
        ).fetchone()
        if (
            workspace["ai_requests"] >= self.config.max_ai_per_workspace
            or (count[0] if count else 0) >= self.config.max_ai_per_day
        ):
            raise APIError(
                429,
                "ai_quota",
                "The AI request allowance has been used. Local semantic search remains available.",
            )
        conn.execute(
            "INSERT INTO ai_usage(day,requests) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET requests=requests+1",
            (day,),
        )
        conn.execute(
            "UPDATE workspaces SET ai_requests=ai_requests+1 WHERE id=?",
            (workspace["id"],),
        )

    def submit_job(self, workspace_id, kind, payload=None):
        payload = payload or {}
        state = self.runtime(workspace_id)
        with state.lock:
            workspace = self.workspace(workspace_id)
            if self.db.one(
                "SELECT id FROM jobs WHERE workspace_id=? AND status IN ('queued','running')",
                (workspace_id,),
            ):
                raise APIError(
                    409,
                    "operation_in_progress",
                    "An operation is already running in this workspace. Let it finish first.",
                )
            docs = self.document_rows(workspace_id)
            if not docs:
                raise APIError(
                    409,
                    "notes_required",
                    "Add readable notes before starting this operation.",
                )
            if kind == "answer" and (
                state.engine is None or state.revision != workspace["revision"]
            ):
                raise APIError(
                    409,
                    "index_required",
                    "Build the search index before requesting an AI answer.",
                )
            if not self.job_slots.acquire(blocking=False):
                raise APIError(
                    429,
                    "queue_full",
                    "The study service is busy. Please retry in a moment.",
                    5,
                )
            job_id = uuid4().hex
            try:
                with self.db.transaction() as conn:
                    if kind != "index":
                        self._reserve_ai(conn, workspace)
                    conn.execute(
                        "INSERT INTO jobs(id,workspace_id,kind,revision,status,phase,created_at) VALUES(?,?,?,?,?,?,?)",
                        (
                            job_id,
                            workspace_id,
                            kind,
                            workspace["revision"],
                            "queued",
                            "queued",
                            self.clock(),
                        ),
                    )
                    conn.execute(
                        "DELETE FROM jobs WHERE workspace_id=? AND status IN ('completed','failed') AND id NOT IN "
                        "(SELECT id FROM jobs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 10)",
                        (workspace_id, workspace_id),
                    )
                self.executor.submit(
                    self._run_job,
                    workspace_id,
                    job_id,
                    workspace["revision"],
                    kind,
                    docs,
                    payload,
                )
            except BaseException:
                self.job_slots.release()
                raise
        return self.get_job(workspace_id, job_id)

    def _check_revision(self, workspace_id, revision):
        if self.workspace(workspace_id)["revision"] != revision:
            raise APIError(
                409,
                "notes_changed",
                "Your notes changed while this operation was running. Please start again.",
            )

    def _run_job(self, workspace_id, job_id, revision, kind, docs, payload):
        candidate = None
        try:
            self.db.execute(
                "UPDATE jobs SET status='running',phase=? WHERE id=?",
                ("loading_model" if kind == "index" else "generating", job_id),
            )
            chunks = tuple(
                chunk for row in docs for chunk in chunk_document(self.document(row))
            )
            self._check_revision(workspace_id, revision)
            if kind == "index":
                with self.index_slot:
                    self._check_revision(workspace_id, revision)
                    candidate = self.engine_factory()
                    self.db.execute(
                        "UPDATE jobs SET phase='indexing' WHERE id=?", (job_id,)
                    )
                    count = candidate.build(chunks)
                state = self.runtime(workspace_id)
                with state.lock:
                    self._check_revision(workspace_id, revision)
                    old, state.engine = state.engine, candidate
                    state.revision = revision
                    candidate = None
                    self.clear_engine(old)
                result = {"indexed_chunks": count}
            elif kind == "answer":
                state = self.runtime(workspace_id)
                with state.lock:
                    self._check_revision(workspace_id, revision)
                    if state.engine is None or state.revision != revision:
                        raise APIError(
                            409,
                            "index_required",
                            "Build the search index before requesting an answer.",
                        )
                    hits = tuple(
                        state.engine.search(payload["question"], k=payload["limit"])
                    )
                answer = self.answer_fn(payload["question"], hits, self.config.core)
                result = {
                    "mode": answer.mode,
                    "message": answer.message,
                    "question": payload["question"],
                    "passages": [passage_json(h) for h in hits],
                    "claims": [
                        {
                            "text": c.text,
                            "citations": [citation_json(q) for q in c.citations],
                        }
                        for c in answer.claims
                    ],
                }
            else:
                generated = self.quiz_fn(
                    chunks, payload["count"], payload["difficulty"], self.config.core
                )
                if generated.mode != "generated":
                    raise APIError(422, "quiz_unavailable", generated.message)
                quiz_id = uuid4().hex
                state = self.runtime(workspace_id)
                with state.lock:
                    self._check_revision(workspace_id, revision)
                    with self.db.transaction() as conn:
                        conn.execute(
                            "INSERT INTO quizzes(id,workspace_id,revision,difficulty,question_count,questions_json,created_at) VALUES(?,?,?,?,?,?,?)",
                            (
                                quiz_id,
                                workspace_id,
                                revision,
                                payload["difficulty"],
                                len(generated.questions),
                                encode([asdict(q) for q in generated.questions]),
                                self.clock(),
                            ),
                        )
                        conn.execute(
                            "DELETE FROM quizzes WHERE workspace_id=? AND id NOT IN (SELECT id FROM quizzes WHERE workspace_id=? ORDER BY created_at DESC LIMIT 10)",
                            (workspace_id, workspace_id),
                        )
                result = {"quiz_id": quiz_id}
            with self.runtime(workspace_id).lock:
                self._check_revision(workspace_id, revision)
                with self.db.transaction() as conn:
                    conn.execute(
                        "UPDATE jobs SET status='completed',phase='complete',result_json=?,finished_at=? WHERE id=? AND workspace_id=?",
                        (encode(result), self.clock(), job_id, workspace_id),
                    )
                    label = {
                        "index": "Search index built",
                        "answer": "Answer request completed",
                        "quiz": "Practice quiz created",
                    }[kind]
                    self.event(conn, workspace_id, kind, label)
        except (APIError, RetrievalError, EmbeddingError) as error:
            safe = (
                {"code": error.code, "message": error.message}
                if isinstance(error, APIError)
                else {"code": "processing_failed", "message": str(error)}
            )
            self.db.execute(
                "UPDATE jobs SET status='failed',phase='failed',error_json=?,finished_at=? WHERE id=? AND workspace_id=?",
                (encode(safe), self.clock(), job_id, workspace_id),
            )
        except Exception:
            self.db.execute(
                "UPDATE jobs SET status='failed',phase='failed',error_json=?,finished_at=? WHERE id=? AND workspace_id=?",
                (
                    encode(
                        {
                            "code": "processing_failed",
                            "message": "This operation could not finish. Your notes are still available; please retry.",
                        }
                    ),
                    self.clock(),
                    job_id,
                    workspace_id,
                ),
            )
        finally:
            self.clear_engine(candidate)
            self.job_slots.release()

    def search(self, workspace_id, question, limit=None):
        state = self.runtime(workspace_id)
        with state.lock:
            workspace = self.workspace(workspace_id)
            if state.engine is None or state.revision != workspace["revision"]:
                raise APIError(
                    409,
                    "index_required",
                    "Build the search index to search your current notes.",
                )
            try:
                hits = state.engine.search(
                    question, k=limit or workspace["result_limit"]
                )
            except RetrievalError as error:
                raise APIError(422, "search_failed", str(error)) from None
            return {
                "question": question.strip(),
                "revision": workspace["revision"],
                "mode": "passages" if hits else "no_evidence",
                "passages": [passage_json(h) for h in hits],
            }

    def list_quizzes(self, workspace_id):
        rows = self.db.all(
            "SELECT q.id,q.question_count,q.difficulty,q.created_at,q.current_attempt,a.score_json FROM quizzes q LEFT JOIN attempts a ON a.quiz_id=q.id AND a.number=q.current_attempt WHERE q.workspace_id=? ORDER BY q.created_at DESC",
            (workspace_id,),
        )
        return [
            {
                "id": row["id"],
                "count": row["question_count"],
                "difficulty": row["difficulty"],
                "created_at": utc(row["created_at"]),
                "attempt_number": row["current_attempt"],
                "submitted": bool(row["score_json"]),
                "score": json.loads(row["score_json"]) if row["score_json"] else None,
            }
            for row in rows
        ]

    def _quiz_row(self, workspace_id, quiz_id):
        workspace = self.workspace(workspace_id)
        row = self.db.one(
            "SELECT * FROM quizzes WHERE id=? AND workspace_id=?",
            (quiz_id, workspace_id),
        )
        if row is None or row["revision"] != workspace["revision"]:
            raise APIError(
                404,
                "quiz_not_found",
                "This quiz is no longer available. Your notes may have changed.",
            )
        return row

    @staticmethod
    def _questions(row):
        result = []
        for item in json.loads(row["questions_json"]):
            citations = tuple(
                Citation(c["source_id"], Chunk(**c["chunk"]), c["quote"])
                for c in item["citations"]
            )
            result.append(
                QuizQuestion(
                    item["question"],
                    tuple(item["options"]),
                    item["correct_index"],
                    item["explanation"],
                    citations,
                )
            )
        return tuple(result)

    def get_quiz(self, workspace_id, quiz_id):
        with self.runtime(workspace_id).lock:
            row = self._quiz_row(workspace_id, quiz_id)
            attempt = self.db.one(
                "SELECT * FROM attempts WHERE quiz_id=? AND number=?",
                (quiz_id, row["current_attempt"]),
            )
            questions = []
            for item in self._questions(row):
                question = {"question": item.question, "options": list(item.options)}
                if attempt:
                    question.update(
                        correct_index=item.correct_index,
                        explanation=item.explanation,
                        citations=[citation_json(c) for c in item.citations],
                    )
                questions.append(question)
            return {
                "id": row["id"],
                "count": row["question_count"],
                "difficulty": row["difficulty"],
                "attempt_number": row["current_attempt"],
                "submitted": attempt is not None,
                "questions": questions,
                "created_at": utc(row["created_at"]),
                "answers": json.loads(attempt["answers_json"]) if attempt else None,
                "score": json.loads(attempt["score_json"]) if attempt else None,
                "can_retake": bool(attempt) and row["current_attempt"] < 20,
            }

    def submit_quiz(self, workspace_id, quiz_id, attempt_number, answers):
        with self.runtime(workspace_id).lock:
            row = self._quiz_row(workspace_id, quiz_id)
            if attempt_number != row["current_attempt"]:
                raise APIError(
                    409,
                    "attempt_changed",
                    "This quiz attempt changed. Refresh it before submitting.",
                )
            previous = self.db.one(
                "SELECT answers_json FROM attempts WHERE quiz_id=? AND number=?",
                (quiz_id, attempt_number),
            )
            if previous:
                if json.loads(previous["answers_json"]) != answers:
                    raise APIError(
                        409,
                        "already_submitted",
                        "This attempt has already been submitted. Retake it for another try.",
                    )
                return self.get_quiz(workspace_id, quiz_id)
            try:
                score = score_quiz(self._questions(row), tuple(answers))
            except QuizValidationError as error:
                raise APIError(422, "invalid_answers", str(error)) from None
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO attempts VALUES(?,?,?,?,?)",
                    (
                        quiz_id,
                        attempt_number,
                        encode(answers),
                        encode(asdict(score)),
                        self.clock(),
                    ),
                )
                self.event(
                    conn,
                    workspace_id,
                    "quiz_submitted",
                    f"Quiz completed: {score.correct}/{score.total}",
                )
            return self.get_quiz(workspace_id, quiz_id)

    def retake(self, workspace_id, quiz_id):
        with self.runtime(workspace_id).lock:
            row = self._quiz_row(workspace_id, quiz_id)
            if row["current_attempt"] >= 20:
                raise APIError(
                    409, "retake_limit", "This quiz has reached its 20-attempt limit."
                )
            if not self.db.one(
                "SELECT 1 FROM attempts WHERE quiz_id=? AND number=?",
                (quiz_id, row["current_attempt"]),
            ):
                raise APIError(
                    409,
                    "attempt_not_submitted",
                    "Complete this attempt before starting a retake.",
                )
            self.db.execute(
                "UPDATE quizzes SET current_attempt=current_attempt+1 WHERE id=? AND workspace_id=?",
                (quiz_id, workspace_id),
            )
            return self.get_quiz(workspace_id, quiz_id)

    def close(self):
        self.closed = True
        self.executor.shutdown(wait=True, cancel_futures=True)
        for state in list(self.runtimes.values()):
            self.clear_engine(state.engine)
        self.db.checkpoint()
        self.db.close()
