"""Read and validate configuration without creating storage or loading AI models."""
from dataclasses import dataclass, field
from pathlib import Path
from collections.abc import Mapping
import os
from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[1]

class ConfigurationError(ValueError):
    """A setting is invalid; messages never include its supplied value."""

@dataclass(frozen=True)
class Settings:
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = "gpt-4o-mini"
    max_upload_mb: int = 10

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key)


def load_settings(env: Mapping[str, str] | None = None,
                  env_file: Path | None = None) -> Settings:
    """Explicit/process variables override project .env, even when blank.

    Supplying env={} disables process variables for deterministic tests.
    No variables are added to the process environment. Missing .env is normal.
    """
    path = PROJECT_ROOT / ".env" if env_file is None else env_file
    try:
        values = dict(dotenv_values(path, interpolate=False)) if path.exists() else {}
    except (OSError, UnicodeError):
        raise ConfigurationError("Cannot read .env; check its permissions and UTF-8 encoding.") from None
    values.update(os.environ if env is None else env)
    key = (values.get("OPENAI_API_KEY") or "").strip()
    model = (values.get("OPENAI_MODEL") or "").strip() or "gpt-4o-mini"
    raw_limit = (values.get("MAX_UPLOAD_MB") or "").strip() or "10"
    # Strict decimal input avoids accidental acceptance of signs/fractions.
    if not raw_limit.isascii() or not raw_limit.isdecimal() or len(raw_limit) > 3:
        raise ConfigurationError("MAX_UPLOAD_MB must be a whole number from 1 to 50.")
    limit = int(raw_limit)
    if not 1 <= limit <= 50:
        raise ConfigurationError("MAX_UPLOAD_MB must be a whole number from 1 to 50.")
    if len(model) > 100 or any(c.isspace() or ord(c) < 32 for c in model):
        raise ConfigurationError("OPENAI_MODEL must be a model name with no whitespace (at most 100 characters).")
    if any(c.isspace() or ord(c) < 32 for c in key):
        raise ConfigurationError("OPENAI_API_KEY must not contain whitespace or control characters.")
    return Settings(key, model, limit)
