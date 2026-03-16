import os

from zotero_mcp import helper_main


class DummyMCP:
    def __init__(self):
        self.calls = []

    def run(self, **kwargs):
        self.calls.append(kwargs)


def test_helper_main_defaults_to_local_streamable_http(monkeypatch):
    dummy = DummyMCP()

    monkeypatch.delenv("ZOTERO_NO_CLAUDE", raising=False)
    monkeypatch.delenv("ZOTERO_LOCAL", raising=False)
    monkeypatch.delenv("ZOTERO_LIBRARY_ID", raising=False)
    monkeypatch.delenv("ZOTERO_LIBRARY_TYPE", raising=False)
    monkeypatch.setattr(helper_main, "mcp", dummy)
    monkeypatch.setattr(helper_main, "setup_zotero_environment", lambda: None)
    monkeypatch.setattr(helper_main, "configure_helper_bridge_proxy", lambda *_args, **_kwargs: None)

    helper_main.main([])

    assert os.environ["ZOTERO_NO_CLAUDE"] == "true"
    assert os.environ["ZOTERO_LOCAL"] == "true"
    assert os.environ["ZOTERO_LIBRARY_ID"] == "0"
    assert os.environ["ZOTERO_LIBRARY_TYPE"] == "user"
    assert dummy.calls == [
        {
            "transport": "streamable-http",
            "host": helper_main.DEFAULT_HOST,
            "port": helper_main.DEFAULT_PORT,
        }
    ]


def test_helper_main_supports_stdio(monkeypatch):
    dummy = DummyMCP()

    monkeypatch.setattr(helper_main, "mcp", dummy)
    monkeypatch.setattr(helper_main, "setup_zotero_environment", lambda: None)

    helper_main.main(["serve", "--transport", "stdio"])

    assert dummy.calls == [{"transport": "stdio"}]


def test_helper_main_uses_profile_port_when_not_explicit(monkeypatch):
    dummy = DummyMCP()

    monkeypatch.delenv("ZOTERO_DESKTOP_MCP_PORT", raising=False)
    monkeypatch.setattr(helper_main, "mcp", dummy)
    monkeypatch.setattr(helper_main, "configure_helper_bridge_proxy", lambda *_args, **_kwargs: None)

    def fake_setup():
        os.environ["ZOTERO_DESKTOP_MCP_PORT"] = "9234"

    monkeypatch.setattr(helper_main, "setup_zotero_environment", fake_setup)

    helper_main.main([])

    assert dummy.calls == [
        {
            "transport": "streamable-http",
            "host": helper_main.DEFAULT_HOST,
            "port": 9234,
        }
    ]
