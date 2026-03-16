import json

from zotero_mcp.local_db import LocalZoteroReader
from zotero_mcp.zotero_profile import (
    discover_active_bridge_secret,
    discover_active_local_mcp_port,
    discover_active_zotero_db_path,
    get_active_profile_info,
)


def _write_profiles_ini(config_root, sections):
    config_root.mkdir(parents=True, exist_ok=True)
    lines = ["[General]", "StartWithLastProfile=1", ""]
    for index, section in enumerate(sections):
        lines.extend(
            [
                f"[Profile{index}]",
                f"Name={section['name']}",
                "IsRelative=1",
                f"Path={section['path']}",
                f"Default={1 if section.get('default') else 0}",
                "",
            ]
        )
    (config_root / "profiles.ini").write_text("\n".join(lines), encoding="utf-8")


def _write_prefs(profile_path, *, data_dir, secret, local_mcp_port):
    profile_path.mkdir(parents=True, exist_ok=True)
    prefs_lines = [
        'user_pref("extensions.zeroMcpPlugin.sharedSecret", %s);' % json.dumps(secret),
        'user_pref("extensions.zeroMcpPlugin.localMcpPort", %s);'
        % json.dumps(str(local_mcp_port)),
        'user_pref("extensions.zotero.useDataDir", true);',
        'user_pref("extensions.zotero.dataDir", %s);' % json.dumps(str(data_dir)),
    ]
    (profile_path / "prefs.js").write_text("\n".join(prefs_lines), encoding="utf-8")


def test_profile_discovery_prefers_locked_profile_and_reads_custom_data_dir(monkeypatch, tmp_path):
    config_root = tmp_path / "Zotero"
    profiles_root = config_root / "Profiles"
    default_profile = profiles_root / "default"
    active_profile = profiles_root / "test"
    data_dir = tmp_path / "zotero_test"
    data_dir.mkdir()
    db_path = data_dir / "zotero.sqlite"
    db_path.write_text("", encoding="utf-8")

    _write_profiles_ini(
        config_root,
        [
            {"name": "default", "path": "Profiles/default", "default": True},
            {"name": "test", "path": "Profiles/test", "default": False},
        ],
    )
    _write_prefs(default_profile, data_dir=tmp_path / "unused", secret="ignored", local_mcp_port=8000)
    _write_prefs(active_profile, data_dir=data_dir, secret="zero-mcp-test-secret", local_mcp_port=9123)
    active_profile.mkdir(parents=True, exist_ok=True)
    (active_profile / "parent.lock").write_text("", encoding="utf-8")

    monkeypatch.setenv("ZOTERO_CONFIG_ROOT", str(config_root))
    monkeypatch.delenv("ZOTERO_PROFILE_NAME", raising=False)
    monkeypatch.delenv("ZOTERO_PROFILE_PATH", raising=False)

    profile = get_active_profile_info()

    assert profile is not None
    assert profile.name == "test"
    assert profile.profile_path == active_profile
    assert discover_active_bridge_secret() == "zero-mcp-test-secret"
    assert discover_active_local_mcp_port() == 9123
    assert discover_active_zotero_db_path() == str(db_path)


def test_local_reader_uses_active_profile_database_path(monkeypatch, tmp_path):
    config_root = tmp_path / "Zotero"
    profile_path = config_root / "Profiles" / "test"
    data_dir = tmp_path / "custom_data"
    data_dir.mkdir(parents=True)
    db_path = data_dir / "zotero.sqlite"
    db_path.write_text("", encoding="utf-8")

    _write_profiles_ini(
        config_root,
        [
            {"name": "test", "path": "Profiles/test", "default": True},
        ],
    )
    _write_prefs(profile_path, data_dir=data_dir, secret="bridge-secret", local_mcp_port=8123)

    monkeypatch.setenv("ZOTERO_CONFIG_ROOT", str(config_root))
    monkeypatch.delenv("ZOTERO_LOCAL_DB_PATH", raising=False)

    reader = LocalZoteroReader()

    assert reader.db_path == str(db_path)
