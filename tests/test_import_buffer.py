from pathlib import Path
import os
import time

from zotero_mcp.import_buffer import maybe_cleanup_buffer_directory, stage_pdf_into_buffer


def test_stage_pdf_into_buffer_uses_hashed_copy_and_reuses_existing_file(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-1.4\nhello")
    buffer_dir = tmp_path / "buffer"

    first = stage_pdf_into_buffer(source, buffer_dir)
    second = stage_pdf_into_buffer(source, buffer_dir)

    assert first.staged_path.parent == buffer_dir.resolve()
    assert first.copied is True
    assert second.staged_path == first.staged_path
    assert second.copied is False
    assert second.reused is True


def test_maybe_cleanup_buffer_directory_removes_old_pdfs(tmp_path):
    buffer_dir = tmp_path / "buffer"
    buffer_dir.mkdir()
    stale_pdf = buffer_dir / "old.pdf"
    fresh_pdf = buffer_dir / "new.pdf"
    stale_pdf.write_bytes(b"%PDF-1.4\nold")
    fresh_pdf.write_bytes(b"%PDF-1.4\nnew")

    old_timestamp = time.time() - (8 * 24 * 60 * 60)
    os.utime(stale_pdf, (old_timestamp, old_timestamp))

    deleted = maybe_cleanup_buffer_directory(
        buffer_dir,
        max_age_seconds=7 * 24 * 60 * 60,
        cleanup_interval_seconds=0,
    )

    assert str(stale_pdf) in deleted
    assert not stale_pdf.exists()
    assert fresh_pdf.exists()
