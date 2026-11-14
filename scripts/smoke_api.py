"""Real API/container smoke check using only public samples; never print tokens."""

import argparse
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--origin", default="http://localhost:5173")
    args = parser.parse_args()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    headers = {"Origin": args.origin, "X-Requested-With": "padhai"}

    def call(path, method="GET", data=None, extra=None):
        request_headers = {**headers, **(extra or {})}
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
            request_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            args.base_url.rstrip("/") + "/api" + path,
            data=data,
            method=method,
            headers=request_headers,
        )
        with opener.open(req, timeout=35) as response:
            return json.loads(response.read()) if response.status != 204 else None

    session = call("/session", "POST")
    headers["X-PadhAI-CSRF"] = session["csrf_token"]
    try:
        root = Path(__file__).resolve().parents[1]
        sample = (root / "sample_data" / "dbms_notes.pdf").read_bytes()
        document = call(
            "/documents",
            "POST",
            sample,
            {
                "X-File-Name": "dbms_notes.pdf",
                "Content-Type": "application/octet-stream",
            },
        )["document"]
        job = call("/index", "POST")
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            status = call("/jobs/" + job["id"])
            if status["status"] in {"completed", "failed"}:
                break
            time.sleep(0.5)
        assert status["status"] == "completed", "Index did not complete successfully."
        result = call(
            "/search",
            "POST",
            {"question": "How does database normalization reduce redundancy?"},
        )
        assert (
            result["passages"]
            and result["passages"][0]["document_id"] == document["id"]
        )
        assert result["passages"][0]["page_number"] == 1
        preview = call("/documents/" + document["id"])
        assert "normalization" in preview["page"]["text"].lower()
        call("/documents/" + document["id"], "DELETE")
        assert call("/workspace")["stats"]["documents"] == 0
        print(
            "Container/API smoke passed: real PDF upload, cached-model index, search, source, deletion."
        )
    finally:
        call("/session", "DELETE")


if __name__ == "__main__":
    main()
