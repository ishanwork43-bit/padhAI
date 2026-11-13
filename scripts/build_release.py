"""Build a source-only ZIP from an explicit allowlist, without dependencies.

The manifest is intentionally restrictive: local notes, credentials, databases,
and unlisted files must never enter an archive by accident. For identical input
bytes, output is reproducible with the same Python/zlib versions.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import unicodedata
import zipfile


class ReleaseError(ValueError):
    """The source tree or output location is unsafe or incomplete."""


FORBIDDEN_DIRECTORIES = {
    ".git", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".cache", ".tox", ".nox", "node_modules", "chroma",
    ".chromadb", "data", "dist", "build", "htmlcov",
}
FORBIDDEN_SUFFIXES = {
    ".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm", ".sqlite-wal",
    ".sqlite-shm", ".sqlite3-wal", ".sqlite3-shm", ".pem", ".key", ".p12",
    ".pfx", ".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z",
    ".pyc", ".pyo", ".log",
}
REQUIRED_FILES = {"VERSION", "release-files.txt"}
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _absolute(path: Path) -> Path:
    # abspath normalizes '..' in caller paths without following symlinks.
    return Path(os.path.abspath(path))


def _reject_symlinks(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ReleaseError("Symlinks are not permitted in release source or output paths.")


def _read_source(path: Path) -> bytes:
    _reject_symlinks(path)
    if not path.is_file():
        raise ReleaseError("Every manifest entry must name an existing regular file.")
    try:
        return path.read_bytes()
    except OSError:
        raise ReleaseError("A release source file could not be read.") from None


def _parse_version(content: bytes) -> str:
    try:
        version = content.decode("ascii").removesuffix("\n").removesuffix("\r")
    except UnicodeDecodeError:
        raise ReleaseError("VERSION must contain an ASCII major.minor.patch version.") from None
    if len(version) > 64 or re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version) is None:
        raise ReleaseError("VERSION must contain major.minor.patch, without leading zeroes or suffixes.")
    return version


def _manifest_paths(content: bytes) -> list[str]:
    try:
        manifest = content.decode("utf-8")
    except UnicodeDecodeError:
        raise ReleaseError("release-files.txt must be UTF-8 text.") from None
    names = set()
    portable_names = set()
    for raw_line in manifest.split("\n"):
        # A trailing CR supports Windows line endings. Paths cannot contain controls.
        name = raw_line.removesuffix("\r").strip(" ")
        if not name or name.startswith("#"):
            continue
        parts = name.split("/")
        if ("\\" in name or ":" in name or PurePosixPath(name).is_absolute()
                or any(part in {"", ".", ".."} for part in parts)
                or any(unicodedata.category(char).startswith("C") for char in name)):
            raise ReleaseError("Manifest paths must be safe relative POSIX paths.")
        lower_parts = [part.lower() for part in parts]
        if (any(part in FORBIDDEN_DIRECTORIES for part in lower_parts)
                or any(part.lower().startswith(".env")
                       and not (index == len(parts) - 1 and part == ".env.example")
                       for index, part in enumerate(parts))
                or any(part in {"secrets.toml", ".coverage"} for part in lower_parts)
                or any(suffix.lower() in FORBIDDEN_SUFFIXES for suffix in PurePosixPath(name).suffixes)):
            raise ReleaseError("The manifest contains a secret, database, archive, or generated/cache path.")
        if name.casefold() in portable_names:
            raise ReleaseError("The release manifest contains duplicate paths.")
        names.add(name)
        portable_names.add(name.casefold())
    if not REQUIRED_FILES <= names:
        raise ReleaseError("The manifest must include VERSION and release-files.txt.")
    return sorted(names)


def _temporary_path(directory: Path, suffix: str) -> Path:
    descriptor, name = tempfile.mkstemp(prefix=".padhai-release-", suffix=suffix, dir=directory)
    os.close(descriptor)
    return Path(name)


def build_release(root: Path, output_dir: Path) -> tuple[Path, Path]:
    """Validate and read all allowed sources before atomically replacing outputs.

    Each final file is replaced atomically. The ZIP and checksum are two files,
    so publishing them together is not a filesystem transaction. Do not modify
    the source tree while this function runs.
    """
    root = _absolute(root)
    _reject_symlinks(root)
    version_bytes = _read_source(root / "VERSION")
    manifest_bytes = _read_source(root / "release-files.txt")
    version = _parse_version(version_bytes)
    names = _manifest_paths(manifest_bytes)
    # Reuse these exact bytes for metadata files, avoiding a second inconsistent read.
    known = {"VERSION": version_bytes, "release-files.txt": manifest_bytes}
    sources = [(name, known[name] if name in known else _read_source(root / name)) for name in names]

    output_dir = _absolute(output_dir)
    _reject_symlinks(output_dir)
    artifact_name = f"padhai-{version}"
    zip_path = output_dir / f"{artifact_name}.zip"
    checksum_path = output_dir / f"{artifact_name}.zip.sha256"
    for destination in (zip_path, checksum_path):
        _reject_symlinks(destination)
        if destination.exists() and not destination.is_file():
            raise ReleaseError("An output artifact path already exists and is not a regular file.")
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ReleaseError("The output directory could not be created.") from None

    zip_temporary = checksum_temporary = None
    try:
        zip_temporary = _temporary_path(output_dir, ".zip.tmp")
        with zipfile.ZipFile(zip_temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, content in sources:
                entry = zipfile.ZipInfo(f"{artifact_name}/{name}", date_time=FIXED_TIMESTAMP)
                entry.create_system = 3  # Stable Unix metadata on macOS, Linux, and Windows.
                entry.external_attr = (0o100644 << 16)
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        digest = hashlib.sha256(zip_temporary.read_bytes()).hexdigest()
        checksum_temporary = _temporary_path(output_dir, ".sha256.tmp")
        checksum_temporary.write_text(f"{digest}  {zip_path.name}\n", encoding="ascii", newline="\n")
        os.replace(zip_temporary, zip_path)
        os.replace(checksum_temporary, checksum_path)
    except OSError:
        raise ReleaseError("Release artifacts could not be written; check the output directory.") from None
    finally:
        for temporary in (zip_temporary, checksum_temporary):
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return zip_path, checksum_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("dist"), help="Output directory (default: dist)")
    args = parser.parse_args()
    root = Path(__file__).absolute().parent.parent
    try:
        output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
        zip_path, checksum_path = build_release(root, output_dir)
    except ReleaseError as error:
        parser.exit(1, f"Release build failed: {error}\n")
    print(f"Created {zip_path}\nCreated {checksum_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
