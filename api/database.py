"""Single-instance SQLite storage; all study data is owned by a workspace."""

from contextlib import contextmanager
from pathlib import Path
from threading import RLock
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 created_at REAL NOT NULL, expires_at REAL NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 result_limit INTEGER NOT NULL DEFAULT 5, ai_consent INTEGER NOT NULL DEFAULT 0,
 ai_requests INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 id TEXT NOT NULL, filename TEXT NOT NULL, byte_size INTEGER NOT NULL,
 pages_json TEXT NOT NULL, warnings_json TEXT NOT NULL, chunk_count INTEGER NOT NULL,
 page_count INTEGER NOT NULL,
 char_count INTEGER NOT NULL, created_at REAL NOT NULL,
 PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
 result_json TEXT, error_json TEXT, created_at REAL NOT NULL, finished_at REAL
);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS quizzes (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, difficulty TEXT NOT NULL, question_count INTEGER NOT NULL,
 questions_json TEXT NOT NULL, current_attempt INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
 quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
 number INTEGER NOT NULL, answers_json TEXT NOT NULL, score_json TEXT NOT NULL,
 created_at REAL NOT NULL, PRIMARY KEY (quiz_id, number)
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, label TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL);
"""


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            raise ValueError("Database path must not be a symbolic link.")
        descriptor = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(descriptor)
        os.chmod(path, 0o600)
        self.lock = RLock()
        self.connection = sqlite3.connect(
            path, check_same_thread=False, isolation_level=None
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA secure_delete=ON")
        self.connection.execute("PRAGMA busy_timeout=5000")
        self.connection.executescript(SCHEMA)
        self.connection.execute(
            "UPDATE jobs SET status='failed', phase='interrupted', "
            "error_json=? WHERE status IN ('queued','running')",
            (
                '{"code":"server_restarted","message":"The server restarted. Please retry this operation."}',
            ),
        )

    def one(self, sql, params=()):
        with self.lock:
            row = self.connection.execute(sql, params).fetchone()
            return dict(row) if row is not None else None

    def all(self, sql, params=()):
        with self.lock:
            return [
                dict(row) for row in self.connection.execute(sql, params).fetchall()
            ]

    @contextmanager
    def transaction(self):
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                yield self.connection
            except BaseException:
                self.connection.rollback()
                raise
            else:
                self.connection.commit()

    def execute(self, sql, params=()):
        with self.lock:
            return self.connection.execute(sql, params).rowcount

    def checkpoint(self):
        with self.lock:
            self.connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def close(self):
        with self.lock:
            self.connection.close()
