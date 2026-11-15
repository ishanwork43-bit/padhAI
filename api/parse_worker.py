"""Resource-bounded upload parser. Launched without the parent's credentials."""

import json
import sys


def main():
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    except ImportError:
        pass  # Windows development still has the parent's wall-clock/body limits.
    from dataclasses import asdict
    from src.document_loader import load_document, DocumentError

    try:
        content = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        result = {"document": asdict(load_document(sys.argv[1], content))}
    except DocumentError as error:
        result = {"error": str(error)}
    except Exception:
        result = {
            "error": "This document could not be processed safely. Try a smaller or re-exported file."
        }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
