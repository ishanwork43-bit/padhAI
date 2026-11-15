"""Explicit server configuration; provider credentials never enter response models."""

from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
import os

from src.config import Settings, load_settings


@dataclass(frozen=True)
class APIConfig:
    database_path: Path = Path("data/padhai.sqlite3")
    origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    secure_cookie: bool = False
    workspace_ttl: int = 86400
    max_workspaces: int = 100
    max_upload_bytes: int = 10 * 1024 * 1024
    max_workspace_bytes: int = 50 * 1024 * 1024
    max_workspace_characters: int = 2_000_000
    max_total_characters: int = 20_000_000
    max_documents: int = 20
    max_chunks: int = 5000
    max_jobs: int = 8
    max_ai_per_workspace: int = 5
    max_ai_per_day: int = 50
    paid_ai_enabled: bool = False
    core: Settings = field(default_factory=Settings, repr=False)

    @property
    def cookie_name(self):
        return "__Host-padhai_workspace" if self.secure_cookie else "padhai_workspace"

    @property
    def ai_available(self):
        return self.paid_ai_enabled and self.core.ai_configured

    @classmethod
    def from_env(cls):
        production = os.getenv("API_ENV", "development") == "production"
        raw = os.getenv("API_ALLOWED_ORIGINS", "")
        origins = tuple(x.strip().rstrip("/") for x in raw.split(",") if x.strip())
        if not origins:
            if production:
                raise ValueError(
                    "API_ALLOWED_ORIGINS must contain the exact frontend HTTPS origin."
                )
            origins = cls.origins
        for origin in origins:
            parsed = urlsplit(origin)
            local = parsed.hostname in {"localhost", "127.0.0.1"}
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or "*" in origin
                or (production and parsed.scheme != "https")
                or (parsed.scheme == "http" and not local)
            ):
                raise ValueError(
                    "API_ALLOWED_ORIGINS must use exact HTTPS origins (localhost HTTP is development-only)."
                )

        def integer(name, default, minimum, maximum):
            raw_value = os.getenv(name, str(default))
            if (
                not raw_value.isascii()
                or not raw_value.isdecimal()
                or len(raw_value) > 10
            ):
                raise ValueError(f"{name} must be a bounded positive integer.")
            result = int(raw_value)
            if not minimum <= result <= maximum:
                raise ValueError(f"{name} is outside its supported range.")
            return result

        return cls(
            database_path=Path(os.getenv("API_DATABASE_PATH", "data/padhai.sqlite3")),
            origins=origins,
            secure_cookie=production,
            workspace_ttl=integer("WORKSPACE_TTL_SECONDS", 86400, 300, 604800),
            max_workspaces=integer("MAX_WORKSPACES", 100, 1, 1000),
            max_ai_per_workspace=integer("AI_REQUESTS_PER_WORKSPACE", 5, 0, 100),
            max_ai_per_day=integer("AI_REQUESTS_PER_DAY", 50, 0, 1000),
            paid_ai_enabled=os.getenv("ENABLE_PAID_AI", "false").lower() == "true",
            core=load_settings(),
        )
