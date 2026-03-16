"""Helpers for discovering the active Zotero profile and selected prefs."""

from __future__ import annotations

from dataclasses import dataclass
import configparser
import json
import os
from pathlib import Path
import platform
import re
from typing import Any


_PREF_LINE_RE = re.compile(r'^user_pref\("(?P<key>[^"]+)",\s*(?P<value>.+)\);\s*$')


@dataclass(frozen=True)
class ZoteroProfileInfo:
    """Resolved information about the currently active Zotero profile."""

    name: str
    profile_path: Path
    prefs: dict[str, Any]

    @property
    def bridge_secret(self) -> str | None:
        value = self.prefs.get("extensions.zeroMcpPlugin.sharedSecret")
        return value.strip() if isinstance(value, str) and value.strip() else None

    @property
    def data_dir(self) -> Path | None:
        if self.prefs.get("extensions.zotero.useDataDir", False):
            value = self.prefs.get("extensions.zotero.dataDir")
            if isinstance(value, str) and value.strip():
                return Path(value.strip())

        profile_db = self.profile_path / "zotero.sqlite"
        if profile_db.exists():
            return self.profile_path
        return self.profile_path

    @property
    def local_mcp_port(self) -> int | None:
        value = self.prefs.get("extensions.zeroMcpPlugin.localMcpPort")
        if value is None:
            return None
        try:
            port = int(str(value).strip())
        except (TypeError, ValueError):
            return None
        if 1 <= port <= 65535:
            return port
        return None


def _candidate_config_roots() -> list[Path]:
    override = os.getenv("ZOTERO_CONFIG_ROOT")
    if override:
        return [Path(override)]

    system = platform.system()
    roots: list[Path] = []

    if system == "Windows":
        appdata = os.getenv("APPDATA")
        if appdata:
            roots.append(Path(appdata) / "Zotero" / "Zotero")
    elif system == "Darwin":
        roots.append(Path.home() / "Library" / "Application Support" / "Zotero" / "Zotero")
    else:
        roots.append(Path.home() / ".zotero" / "zotero")
        roots.append(Path.home() / ".config" / "zotero")

    return roots


def _load_profiles(config_root: Path) -> list[tuple[str, Path, bool]]:
    profiles_ini = config_root / "profiles.ini"
    if not profiles_ini.exists():
        return []

    parser = configparser.RawConfigParser()
    parser.read(profiles_ini, encoding="utf-8")

    profiles: list[tuple[str, Path, bool]] = []
    for section in parser.sections():
        if not section.startswith("Profile"):
            continue

        name = parser.get(section, "Name", fallback=section)
        raw_path = parser.get(section, "Path", fallback="")
        if not raw_path:
            continue

        is_relative = parser.getboolean(section, "IsRelative", fallback=True)
        profile_path = config_root / raw_path if is_relative else Path(raw_path)
        is_default = parser.getboolean(section, "Default", fallback=False)
        profiles.append((name, profile_path, is_default))

    return profiles


def _decode_pref_value(raw: str) -> Any:
    value = raw.strip()
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if value.startswith('"'):
        return json.loads(value)
    try:
        return int(value)
    except ValueError:
        return value


def _load_prefs(prefs_path: Path) -> dict[str, Any]:
    prefs: dict[str, Any] = {}
    if not prefs_path.exists():
        return prefs

    for line in prefs_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = _PREF_LINE_RE.match(line.strip())
        if not match:
            continue
        try:
            prefs[match.group("key")] = _decode_pref_value(match.group("value"))
        except Exception:
            continue
    return prefs


def _choose_profile(profiles: list[tuple[str, Path, bool]]) -> tuple[str, Path] | None:
    if not profiles:
        return None

    target_name = os.getenv("ZOTERO_PROFILE_NAME")
    if target_name:
        for name, path, _ in profiles:
            if name == target_name:
                return name, path

    target_path = os.getenv("ZOTERO_PROFILE_PATH")
    if target_path:
        wanted = Path(target_path).resolve()
        for name, path, _ in profiles:
            if path.resolve() == wanted:
                return name, path

    locked_profiles: list[tuple[float, str, Path]] = []
    for name, path, _ in profiles:
        lock_path = path / "parent.lock"
        if lock_path.exists():
            locked_profiles.append((lock_path.stat().st_mtime, name, path))

    if locked_profiles:
        _, name, path = max(locked_profiles, key=lambda item: item[0])
        return name, path

    for name, path, is_default in profiles:
        if is_default:
            return name, path

    name, path, _ = profiles[0]
    return name, path


def get_active_profile_info() -> ZoteroProfileInfo | None:
    """Return the active Zotero profile info, if it can be discovered."""
    for config_root in _candidate_config_roots():
        profiles = _load_profiles(config_root)
        chosen = _choose_profile(profiles)
        if not chosen:
            continue

        name, profile_path = chosen
        prefs = _load_prefs(profile_path / "prefs.js")
        return ZoteroProfileInfo(name=name, profile_path=profile_path, prefs=prefs)

    return None


def discover_active_bridge_secret() -> str | None:
    """Return the active profile's configured Zero MCP bridge secret, if available."""
    profile = get_active_profile_info()
    return profile.bridge_secret if profile else None


def discover_active_zotero_db_path() -> str | None:
    """Return the active profile's configured zotero.sqlite path, if available."""
    profile = get_active_profile_info()
    if not profile or not profile.data_dir:
        return None

    db_path = profile.data_dir / "zotero.sqlite"
    if db_path.exists():
        return str(db_path)
    return None


def discover_active_local_mcp_port() -> int | None:
    """Return the active profile's configured local MCP port, if available."""
    profile = get_active_profile_info()
    return profile.local_mcp_port if profile else None
