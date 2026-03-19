from __future__ import annotations

import json

from zotero_mcp import server


class DummyContext:
    def info(self, *_args, **_kwargs):
        return None

    def error(self, *_args, **_kwargs):
        return None

    def warn(self, *_args, **_kwargs):
        return None


class FakeReader:
    def __init__(self, items, fulltext_keys=None):
        self._items = items
        self._fulltext_keys = fulltext_keys or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def get_items(self, **_kwargs):
        return self._items

    def search_item_keys_by_fulltext(self, *_args, **_kwargs):
        return self._fulltext_keys


def test_chatgpt_connector_search_returns_keyword_matches(monkeypatch):
    fake_items = [
        {
            "key": "ITEM0001",
            "data": {
                "itemType": "journalArticle",
                "title": "Multi-Modal Memory Agents in 2025",
                "creators": [{"firstName": "Ada", "lastName": "Lovelace"}],
                "tags": [{"tag": "memory"}],
            },
        },
        {
            "key": "ITEM0002",
            "data": {
                "itemType": "journalArticle",
                "title": "Planning Systems",
                "creators": [{"firstName": "Alan", "lastName": "Turing"}],
                "tags": [{"tag": "planning"}],
            },
        },
    ]
    monkeypatch.setattr(server, "LocalZoteroReader", lambda: FakeReader(fake_items))

    payload = json.loads(
        server.chatgpt_connector_search(query="memory", ctx=DummyContext())
    )

    assert payload == {
        "results": [
            {
                "id": "ITEM0001",
                "title": "Multi-Modal Memory Agents in 2025",
                "url": "zotero://select/items/ITEM0001",
            }
        ]
    }


def test_chatgpt_connector_search_normalizes_hyphenated_queries(monkeypatch):
    fake_items = [
        {
            "key": "ITEM0003",
            "data": {
                "itemType": "journalArticle",
                "title": "M3-Agent Memory Systems",
                "creators": [{"firstName": "Lin", "lastName": "Long"}],
                "tags": [],
            },
        }
    ]
    monkeypatch.setattr(server, "LocalZoteroReader", lambda: FakeReader(fake_items))

    payload = json.loads(
        server.chatgpt_connector_search(query="M3 Agent", ctx=DummyContext())
    )

    assert payload == {
        "results": [
            {
                "id": "ITEM0003",
                "title": "M3-Agent Memory Systems",
                "url": "zotero://select/items/ITEM0003",
            }
        ]
    }


def test_chatgpt_connector_search_uses_fulltext_fallback(monkeypatch):
    fake_items = [
        {
            "key": "ITEM0004",
            "data": {
                "itemType": "journalArticle",
                "title": "Seeing, Listening, Remembering, and Reasoning",
                "creators": [{"firstName": "Wei", "lastName": "Li"}],
                "tags": [],
            },
        }
    ]
    monkeypatch.setattr(
        server,
        "LocalZoteroReader",
        lambda: FakeReader(fake_items, fulltext_keys=["ITEM0004"]),
    )

    payload = json.loads(
        server.chatgpt_connector_search(query="M3 Agent", ctx=DummyContext())
    )

    assert payload == {
        "results": [
            {
                "id": "ITEM0004",
                "title": "Seeing, Listening, Remembering, and Reasoning",
                "url": "zotero://select/items/ITEM0004",
            }
        ]
    }


def test_zotero_search_items_uses_fulltext_fallback(monkeypatch):
    fake_items = [
        {
            "key": "ITEM0005",
            "data": {
                "itemType": "journalArticle",
                "title": "Seeing, Listening, Remembering, and Reasoning",
                "creators": [{"firstName": "Wei", "lastName": "Li"}],
                "tags": [],
            },
        }
    ]
    monkeypatch.setattr(
        server,
        "LocalZoteroReader",
        lambda: FakeReader(fake_items, fulltext_keys=["ITEM0005"]),
    )

    result = server.search_items(query="M3 Agent", qmode="everything", ctx=DummyContext())

    assert "Seeing, Listening, Remembering, and Reasoning" in result


def test_chatgpt_connector_search_empty_query_returns_empty_results():
    payload = json.loads(server.chatgpt_connector_search(query="   ", ctx=DummyContext()))

    assert payload == {"results": []}
