from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "packaging" / "plugin" / "build_xpi.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("build_xpi", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_build_all_xpis_creates_dual_artifacts(tmp_path):
    module = _load_module()

    built = module.build_all_xpis(tmp_path)

    assert len(built) == 2
    assert {path.name for path in built} == {
        "zotero_copilot_0.3.0_zotero7_plugin.xpi",
        "zotero_copilot_0.3.0_zotero8_plugin.xpi",
    }


def test_z7_xpi_uses_z7_manifest_and_excludes_templates(tmp_path):
    module = _load_module()

    output_path = module.build_xpi("z7", tmp_path)

    with zipfile.ZipFile(output_path) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))

    assert "manifest.json" in names
    assert "plugin-compat.js" in names
    assert "plugin-main.js" in names
    assert "manifest.z7.json" not in names
    assert "manifest.z8.json" not in names
    assert manifest["name"] == "Zotero Copilot"
    assert manifest["version"] == "0.3.0"
    assert manifest["applications"]["zotero"]["strict_min_version"] == "7.0"
    assert manifest["applications"]["zotero"]["strict_max_version"] == "7.0.*"


def test_z8_xpi_uses_z8_manifest(tmp_path):
    module = _load_module()

    output_path = module.build_xpi("z8", tmp_path)

    with zipfile.ZipFile(output_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))

    assert manifest["name"] == "Zotero Copilot"
    assert manifest["version"] == "0.3.0"
    assert manifest["applications"]["zotero"]["strict_min_version"] == "8.0"
    assert manifest["applications"]["zotero"]["strict_max_version"] == "8.0.*"


def test_preferences_xhtml_is_well_formed_xml():
    preferences_path = ROOT / "zero-mcp-plugin" / "preferences.xhtml"
    ET.fromstring(preferences_path.read_text(encoding="utf-8"))
