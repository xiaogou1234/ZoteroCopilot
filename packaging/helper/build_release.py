"""
Archive PyInstaller onedir helper builds into public release artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path


def sha256sum(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_readme_text(platform_name: str, product_name: str) -> str:
    executable_name = product_name + (".exe" if platform_name == "windows" else "")
    lines = [
        "Zotero Copilot Helper",
        "",
        f"Package: {product_name}",
        "",
        "Usage:",
        f"1. Extract this archive and keep the whole `{product_name}` directory intact.",
        "2. In Zotero Copilot preferences, choose the executable inside the extracted directory.",
        "3. Do not move only the executable file; `_internal/` must stay next to it.",
        "",
        f"Executable path: {product_name}/{executable_name}",
    ]
    if platform_name == "macos":
        lines += [
            "",
            "If macOS blocks startup after extraction, remove quarantine on the extracted directory:",
            f"xattr -dr com.apple.quarantine {product_name}",
        ]
    return "\n".join(lines) + "\n"


def write_bundle_checksums(bundle_dir: Path) -> Path:
    checksum_lines = []
    for path in sorted(bundle_dir.rglob("*")):
        if not path.is_file():
            continue
        checksum_lines.append(f"{sha256sum(path)}  {path.relative_to(bundle_dir).as_posix()}")

    checksum_path = bundle_dir / "SHA256SUMS.txt"
    checksum_path.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    return checksum_path


def create_archive(platform_name: str, bundle_dir: Path, archive_path: Path) -> Path:
    archive_path.parent.mkdir(parents=True, exist_ok=True)

    if archive_path.exists():
        archive_path.unlink()

    if platform_name == "macos":
        with tarfile.open(archive_path, "w:gz") as archive:
            archive.add(bundle_dir, arcname=bundle_dir.name)
        return archive_path

    if platform_name == "windows":
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(bundle_dir.rglob("*")):
                archive.write(path, path.relative_to(bundle_dir.parent).as_posix())
        return archive_path

    raise ValueError(f"Unsupported platform: {platform_name}")


def build_release_archive(
    platform_name: str,
    source_dir: Path,
    output_dir: Path,
) -> dict[str, Path]:
    resolved_source_dir = source_dir.expanduser().resolve()
    if not resolved_source_dir.exists() or not resolved_source_dir.is_dir():
        raise FileNotFoundError(f"Missing onedir build directory: {resolved_source_dir}")

    product_name = resolved_source_dir.name
    archive_suffix = ".tar.gz" if platform_name == "macos" else ".zip"
    archive_path = output_dir.expanduser().resolve() / f"{product_name}{archive_suffix}"

    with tempfile.TemporaryDirectory(prefix=f"{product_name}_release_") as temp_dir:
        staging_root = Path(temp_dir)
        staged_bundle_dir = staging_root / product_name
        shutil.copytree(resolved_source_dir, staged_bundle_dir)

        readme_path = staged_bundle_dir / "README.txt"
        readme_path.write_text(
            build_readme_text(platform_name, product_name),
            encoding="utf-8",
        )
        write_bundle_checksums(staged_bundle_dir)
        create_archive(platform_name, staged_bundle_dir, archive_path)

    archive_checksum_path = archive_path.parent / f"{product_name}_SHA256SUMS.txt"
    archive_checksum_path.write_text(
        f"{sha256sum(archive_path)}  {archive_path.name}\n",
        encoding="utf-8",
    )

    return {
        "archive": archive_path,
        "archive_checksums": archive_checksum_path,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Archive a Zotero Copilot helper build")
    parser.add_argument(
        "--platform",
        choices=["macos", "windows"],
        required=True,
        help="Target platform for release archive naming",
    )
    parser.add_argument(
        "--source-dir",
        required=True,
        help="Path to the PyInstaller onedir output directory",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where release archives should be written",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = build_release_archive(
        platform_name=args.platform,
        source_dir=Path(args.source_dir),
        output_dir=Path(args.output_dir),
    )

    print(result["archive"])
    print(result["archive_checksums"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
