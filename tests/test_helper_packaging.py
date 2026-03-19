from __future__ import annotations

import importlib.util
from pathlib import Path
import tarfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_MODULE_PATH = ROOT / "packaging" / "helper" / "helper_build_manifest.py"
RELEASE_MODULE_PATH = ROOT / "packaging" / "helper" / "build_release.py"


def _load_module(module_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_helper_build_manifest_excludes_semantic_packages():
    module = _load_module(MANIFEST_MODULE_PATH, "helper_build_manifest")
    collected_packages = []
    copied_metadata = []

    def fake_collect_all(package_name):
        collected_packages.append(package_name)
        return ([], [], [f"hidden:{package_name}"])

    def fake_copy_metadata(metadata_name):
        copied_metadata.append(metadata_name)
        return [("meta", metadata_name)]

    manifest = module.build_manifest(fake_collect_all, fake_copy_metadata)

    assert "torch" not in collected_packages
    assert "transformers" not in collected_packages
    assert "chromadb" not in collected_packages
    assert "openai" not in collected_packages
    assert "google-genai" not in copied_metadata
    assert "torch" in module.EXCLUDED_MODULES
    assert "onnxruntime" in module.EXCLUDED_MODULES
    assert manifest["hiddenimports"]


def test_build_release_archive_creates_macos_tarball(tmp_path):
    module = _load_module(RELEASE_MODULE_PATH, "build_release")
    source_dir = tmp_path / "zotero_copilot_0.3.0_helper_macos_arm64"
    internal_dir = source_dir / "_internal"
    internal_dir.mkdir(parents=True)
    (source_dir / source_dir.name).write_text("helper", encoding="utf-8")
    (internal_dir / "module.py").write_text("print('ok')\n", encoding="utf-8")

    result = module.build_release_archive("macos", source_dir, tmp_path / "releases")

    assert result["archive"].name == "zotero_copilot_0.3.0_helper_macos_arm64.tar.gz"
    assert result["archive_checksums"].name == "zotero_copilot_0.3.0_helper_macos_arm64_SHA256SUMS.txt"

    with tarfile.open(result["archive"], "r:gz") as archive:
        names = set(archive.getnames())

    assert "zotero_copilot_0.3.0_helper_macos_arm64/README.txt" in names
    assert "zotero_copilot_0.3.0_helper_macos_arm64/SHA256SUMS.txt" in names
    assert "zotero_copilot_0.3.0_helper_macos_arm64/_internal/module.py" in names


def test_build_release_archive_creates_windows_zip(tmp_path):
    module = _load_module(RELEASE_MODULE_PATH, "build_release")
    source_dir = tmp_path / "zotero_copilot_0.3.0_helper_windows_x64"
    internal_dir = source_dir / "_internal"
    internal_dir.mkdir(parents=True)
    (source_dir / "zotero_copilot_0.3.0_helper_windows_x64.exe").write_text(
        "helper",
        encoding="utf-8",
    )
    (internal_dir / "module.py").write_text("print('ok')\n", encoding="utf-8")

    result = module.build_release_archive("windows", source_dir, tmp_path / "releases")

    assert result["archive"].name == "zotero_copilot_0.3.0_helper_windows_x64.zip"
    assert result["archive_checksums"].name == "zotero_copilot_0.3.0_helper_windows_x64_SHA256SUMS.txt"

    with zipfile.ZipFile(result["archive"]) as archive:
        names = set(archive.namelist())

    assert "zotero_copilot_0.3.0_helper_windows_x64/README.txt" in names
    assert "zotero_copilot_0.3.0_helper_windows_x64/SHA256SUMS.txt" in names
    assert "zotero_copilot_0.3.0_helper_windows_x64/_internal/module.py" in names
