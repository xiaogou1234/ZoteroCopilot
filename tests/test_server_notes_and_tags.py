from zotero_mcp import server


class DummyContext:
    def info(self, *_args, **_kwargs):
        return None

    def error(self, *_args, **_kwargs):
        return None

    def warn(self, *_args, **_kwargs):
        return None


class FakeReader:
    def __init__(self, notes=None, items=None, parents=None):
        self._notes = notes or []
        self._items = items or []
        self._parents = parents or {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def get_notes(self, item_key=None, limit=None, **_kwargs):
        notes = self._notes
        if item_key:
            notes = [note for note in notes if note.get("data", {}).get("parentItem") == item_key]
        return notes[:limit] if limit else notes

    def get_item_details_by_key(self, item_key, **_kwargs):
        return self._parents.get(item_key)

    def get_items(self, **_kwargs):
        return self._items


def test_search_notes_returns_only_matching_notes(monkeypatch):
    notes = [
        {
            "key": "NOTE0001",
            "data": {
                "itemType": "note",
                "note": "<p>A quantum-computing note.</p>",
                "parentItem": "ITEM0001",
                "tags": [{"tag": "research"}],
            },
        },
        {
            "key": "NOTE0002",
            "data": {
                "itemType": "note",
                "note": "<p>This note is unrelated.</p>",
                "parentItem": "ITEM0002",
            },
        },
    ]
    parents = {
        "ITEM0001": {"data": {"title": "Quantum Book"}},
        "ITEM0002": {"data": {"title": "Other Book"}},
    }
    monkeypatch.setattr(server, "LocalZoteroReader", lambda: FakeReader(notes=notes, parents=parents))

    result = server.search_notes(query="quantum", limit=20, ctx=DummyContext())

    assert "NOTE0001" in result
    assert "Quantum Book" in result
    assert "NOTE0002" not in result
    assert "Annotation" not in result


def test_batch_update_tags_validates_json_array():
    result = server.batch_update_tags(
        query="anything",
        add_tags='{"not":"a-list"}',
        remove_tags=None,
        limit=5,
        ctx=DummyContext(),
    )

    assert "must be a JSON array or a list of strings" in result


def test_batch_update_tags_accepts_plain_string(monkeypatch):
    items = [
        {
            "key": "ITEM0001",
            "data": {
                "itemType": "journalArticle",
                "title": "Anything about agents",
                "creators": [],
                "tags": [],
            },
        }
    ]
    monkeypatch.setattr(server, "LocalZoteroReader", lambda: FakeReader(items=items))

    class FakeBridge:
        def batch_update_tags(self, **payload):
            assert payload["addTags"] == ["test-tag"]
            assert payload["removeTags"] == []
            return {"updated": 1, "skipped": 0, "failed": 0}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.batch_update_tags(
        query="agents",
        add_tags="test-tag",
        remove_tags=None,
        limit=10,
        ctx=DummyContext(),
    )

    assert "Items updated: 1" in result


def test_batch_update_tags_uses_bridge(monkeypatch):
    items = [
        {
            "key": "ITEM0001",
            "data": {
                "itemType": "journalArticle",
                "title": "Anything about agents",
                "creators": [],
                "tags": [{"tag": "old"}],
            },
        }
    ]
    monkeypatch.setattr(server, "LocalZoteroReader", lambda: FakeReader(items=items))

    class FakeBridge:
        def batch_update_tags(self, **payload):
            assert payload["itemKeys"] == ["ITEM0001"]
            assert payload["addTags"] == ["new"]
            assert payload["removeTags"] == ["old"]
            return {"updated": 1, "skipped": 0, "failed": 0}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.batch_update_tags(
        query="agents",
        add_tags=["new"],
        remove_tags=["old"],
        limit=10,
        ctx=DummyContext(),
    )

    assert "Items updated: 1" in result
