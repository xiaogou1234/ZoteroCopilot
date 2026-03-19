"""Build Zotero plugin XPI artifacts for supported Zotero major versions."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_DIR = ROOT / "zero-mcp-plugin"
VERSION_FILE = ROOT / "src" / "zotero_mcp" / "_version.py"
DEFAULT_OUTPUT_DIR = ROOT / "dist" / "plugins"
MANIFEST_TEMPLATES = {
    "z7": PLUGIN_DIR / "manifest.z7.json",
    "z8": PLUGIN_DIR / "manifest.z8.json",
}
PLUGIN_TARGET_LABELS = {
    "z7": "zotero7",
    "z8": "zotero8",
}
SKIP_FILENAMES = {
    "manifest.json",
    "manifest.z7.json",
    "manifest.z8.json",
}


def read_version(version_file: Path = VERSION_FILE) -> str:
    text = version_file.read_text(encoding="utf-8")
    match = re.search(r'__version__\s*=\s*"([^"]+)"', text)
    if not match:
        raise RuntimeError(f"Could not read version from {version_file}")
    return match.group(1)


def load_manifest(target: str, version: str) -> dict:
    manifest_path = MANIFEST_TEMPLATES[target]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = version
    return manifest


def iter_plugin_files() -> list[Path]:
    files: list[Path] = []
    for path in sorted(PLUGIN_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SKIP_FILENAMES or path.name == ".DS_Store":
            continue
        files.append(path)
    return files


def plugin_artifact_name(target: str, version: str) -> str:
    if target not in PLUGIN_TARGET_LABELS:
        raise ValueError(f"Unsupported target {target!r}")
    return f"zotero_copilot_{version}_{PLUGIN_TARGET_LABELS[target]}_plugin.xpi"


def build_xpi(target: str, output_dir: Path, version: str | None = None) -> Path:
    if target not in MANIFEST_TEMPLATES:
        raise ValueError(f"Unsupported target {target!r}")

    output_dir.mkdir(parents=True, exist_ok=True)
    resolved_version = version or read_version()
    manifest = load_manifest(target, resolved_version)
    output_path = output_dir / plugin_artifact_name(target, resolved_version)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        for path in iter_plugin_files():
            archive.write(path, path.relative_to(PLUGIN_DIR).as_posix())

    return output_path


def build_all_xpis(output_dir: Path, version: str | None = None) -> list[Path]:
    resolved_version = version or read_version()
    return [
        build_xpi("z7", output_dir, resolved_version),
        build_xpi("z8", output_dir, resolved_version),
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build ZoteroCopilot plugin XPI artifacts")
    parser.add_argument(
        "--target",
        choices=["all", "z7", "z8"],
        default="all",
        help="Which plugin artifact to build (default: all)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Output directory for XPI artifacts (default: {DEFAULT_OUTPUT_DIR})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = Path(args.output_dir).expanduser().resolve()
    version = read_version()

    if args.target == "all":
        built = build_all_xpis(output_dir, version)
    else:
        built = [build_xpi(args.target, output_dir, version)]

    for path in built:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
