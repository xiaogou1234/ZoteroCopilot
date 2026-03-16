"""Helpers for staging PDFs into a configured local import buffer."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import os
from pathlib import Path
import shutil
import time

DEFAULT_BUFFER_MAX_AGE_SECONDS = int(
    os.getenv("ZOTERO_DESKTOP_BUFFER_MAX_AGE_SECONDS", str(7 * 24 * 60 * 60))
)
DEFAULT_BUFFER_CLEANUP_INTERVAL_SECONDS = int(
    os.getenv("ZOTERO_DESKTOP_BUFFER_CLEANUP_INTERVAL_SECONDS", str(15 * 60))
)

_LAST_CLEANUP_AT: dict[str, float] = {}


class ImportBufferError(RuntimeError):
    """Raised when PDF staging into the local import buffer fails."""


@dataclass
class StagedPDF:
    """Metadata about a PDF staged into the import buffer."""

    source_path: Path
    staged_path: Path
    copied: bool
    reused: bool

    def cleanup_if_temporary(self) -> None:
        """Delete a newly staged file created only for a preview/dry-run."""
        if self.copied and self.staged_path.exists():
            self.staged_path.unlink()


def _normalize_directory(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def _sanitize_filename(name: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in ("-", "_", ".") else "_" for char in name)
    cleaned = cleaned.strip("._")
    return cleaned or "document.pdf"


def _is_within_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _hash_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _touch(path: Path) -> None:
    now = time.time()
    os.utime(path, (now, now))


def maybe_cleanup_buffer_directory(
    buffer_directory: str | Path,
    *,
    max_age_seconds: int = DEFAULT_BUFFER_MAX_AGE_SECONDS,
    cleanup_interval_seconds: int = DEFAULT_BUFFER_CLEANUP_INTERVAL_SECONDS,
) -> list[str]:
    """Lazily remove stale staged PDFs from the buffer directory."""
    directory = _normalize_directory(buffer_directory)
    directory.mkdir(parents=True, exist_ok=True)

    now = time.time()
    cache_key = str(directory)
    last_cleanup = _LAST_CLEANUP_AT.get(cache_key, 0.0)
    if now - last_cleanup < cleanup_interval_seconds:
        return []

    deleted: list[str] = []
    for candidate in directory.glob("*.pdf"):
        try:
            age_seconds = now - candidate.stat().st_mtime
        except OSError:
            continue
        if age_seconds < max_age_seconds:
            continue
        try:
            candidate.unlink()
            deleted.append(str(candidate))
        except OSError:
            continue

    _LAST_CLEANUP_AT[cache_key] = now
    return deleted


def stage_pdf_into_buffer(
    file_path: str | Path,
    buffer_directory: str | Path,
) -> StagedPDF:
    """Copy a PDF into the configured buffer directory and return the staged path."""
    source = Path(file_path).expanduser()
    if not source.exists() or not source.is_file():
        raise ImportBufferError(f"Source PDF does not exist: {source}")
    if source.suffix.lower() != ".pdf":
        raise ImportBufferError(f"Only PDF files can be staged: {source}")

    buffer_dir = _normalize_directory(buffer_directory)
    buffer_dir.mkdir(parents=True, exist_ok=True)

    source_resolved = source.resolve()
    if _is_within_directory(source_resolved, buffer_dir):
        _touch(source_resolved)
        return StagedPDF(
            source_path=source_resolved,
            staged_path=source_resolved,
            copied=False,
            reused=True,
        )

    maybe_cleanup_buffer_directory(buffer_dir)

    digest = _hash_file(source_resolved)
    target_name = f"{digest[:16]}-{_sanitize_filename(source_resolved.name)}"
    staged_path = buffer_dir / target_name

    copied = False
    reused = staged_path.exists()
    if not staged_path.exists():
        shutil.copy2(source_resolved, staged_path)
        copied = True
    _touch(staged_path)

    return StagedPDF(
        source_path=source_resolved,
        staged_path=staged_path,
        copied=copied,
        reused=reused and not copied,
    )


def collect_pdf_paths(directory_path: str | Path, *, recursive: bool = False) -> list[str]:
    """Collect PDFs from a source directory before staging them into the buffer."""
    directory = Path(directory_path).expanduser()
    if not directory.exists() or not directory.is_dir():
        raise ImportBufferError(f"Source directory does not exist: {directory}")

    iterator = directory.rglob("*.pdf") if recursive else directory.glob("*.pdf")
    return sorted(str(path.resolve()) for path in iterator if path.is_file())
