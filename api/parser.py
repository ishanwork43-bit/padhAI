"""Process uploads outside the API process with a deadline and bounded output."""

from hashlib import sha256
from pathlib import Path
from threading import BoundedSemaphore
import json
import os
import selectors
import subprocess
import sys
import time

from api.errors import APIError
from src.document_loader import Document, Page, _filename

_slot = BoundedSemaphore(1)
ROOT = Path(__file__).resolve().parents[1]


def parse_upload(filename: str, content: bytes) -> Document:
    filename = _filename(filename)
    if not _slot.acquire(blocking=False):
        raise APIError(
            429,
            "parser_busy",
            "Another document is being processed. Please retry in a moment.",
            3,
        )
    try:
        # Do not pass OPENAI_API_KEY, proxy credentials, or the parent's other secrets.
        env = {
            "PATH": os.defpath,
            "PYTHONPATH": str(ROOT),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "LANG": "C.UTF-8",
        }
        with subprocess.Popen(
            [sys.executable, "-m", "api.parse_worker", filename],
            cwd=ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as child:
            # Upload bytes are already bounded. A dedicated writer avoids pipe deadlock.
            from threading import Thread

            def send():
                try:
                    child.stdin.write(content)
                    child.stdin.close()
                except (BrokenPipeError, OSError, ValueError):
                    pass

            writer = Thread(target=send, daemon=True)
            writer.start()
            output = bytearray()
            deadline = time.monotonic() + 25
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        child.kill()
                        raise APIError(
                            422,
                            "document_timeout",
                            "This document takes too long to process. Split or re-export it.",
                        )
                    if not selector.select(timeout=min(remaining, 1)):
                        continue
                    block = os.read(child.stdout.fileno(), 65536)
                    if not block:
                        break
                    output.extend(block)
                    if len(output) > 8 * 1024 * 1024:
                        child.kill()
                        raise APIError(
                            422,
                            "document_too_complex",
                            "The extracted document is too large. Split it into smaller files.",
                        )
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                raise APIError(
                    422,
                    "document_timeout",
                    "This document did not finish processing. Try re-exporting it.",
                ) from None
            writer.join(timeout=1)
            if child.returncode != 0:
                raise APIError(
                    422,
                    "document_too_complex",
                    "This document exceeded processing limits. Try a smaller or re-exported file.",
                )
        payload = json.loads(output)
        if "error" in payload:
            raise APIError(422, "invalid_document", payload["error"])
        raw = payload["document"]
        if (
            raw["document_id"] != sha256(content).hexdigest()
            or raw["filename"] != filename
            or raw["byte_size"] != len(content)
        ):
            raise ValueError("Parser identity mismatch")
        pages = tuple(Page(p["text"], p["page_number"]) for p in raw["pages"])
        return Document(
            raw["document_id"],
            raw["filename"],
            pages,
            tuple(raw["warnings"]),
            raw["byte_size"],
        )
    except APIError:
        raise
    except Exception:
        raise APIError(
            422,
            "invalid_document",
            "This document could not be processed. Try a smaller or re-exported file.",
        ) from None
    finally:
        _slot.release()
