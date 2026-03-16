import sys

import pytest

if sys.version_info >= (3, 14):
    pytest.skip(
        "chromadb currently relies on pydantic v1 paths that are incompatible with Python 3.14+",
        allow_module_level=True,
    )

pytest.importorskip("chromadb")

from zotero_mcp import semantic_search


class FakeChromaClient:
    def __init__(self):
        self.upserted_ids = []
        self.embedding_max_tokens = 8000
        self.reset_called = False
        self.deleted_ids = []

    def get_existing_ids(self, ids):
        # Pretend item A already exists and item B is new.
        return {"ITEMA001"} & set(ids)

    def upsert_documents(self, documents, metadatas, ids):
        self.upserted_ids.extend(ids)

    def reset_collection(self):
        self.reset_called = True

    def get_collection_info(self):
        return {"count": 3}

    def search(self, query_texts, n_results, where=None):
        return {
            "ids": [["STALE001", "ITEMB002"]],
            "distances": [[0.2, 0.4]],
            "documents": [["stale text", "valid text"]],
            "metadatas": [[{}, {}]],
        }

    def delete_documents(self, ids):
        self.deleted_ids.extend(ids)


def test_process_item_batch_tracks_added_vs_updated(monkeypatch):
    search = semantic_search.ZoteroSemanticSearch(chroma_client=FakeChromaClient())

    items = [
        {
            "key": "ITEMA001",
            "data": {
                "title": "Existing Item",
                "itemType": "journalArticle",
                "abstractNote": "A",
                "creators": [],
            },
        },
        {
            "key": "ITEMB002",
            "data": {
                "title": "New Item",
                "itemType": "journalArticle",
                "abstractNote": "B",
                "creators": [],
            },
        },
    ]

    stats = search._process_item_batch(items, force_rebuild=False)

    assert stats["processed"] == 2
    assert stats["updated"] == 1
    assert stats["added"] == 1


def test_force_rebuild_resets_collection(monkeypatch):
    chroma = FakeChromaClient()
    search = semantic_search.ZoteroSemanticSearch(chroma_client=chroma)
    monkeypatch.setattr(
        search,
        "_get_items_from_source",
        lambda **_kwargs: [
            {
                "key": "ITEMB002",
                "data": {"title": "Only Item", "itemType": "report", "creators": []},
            }
        ],
    )

    stats = search.update_database(force_full_rebuild=True, limit=1)

    assert chroma.reset_called is True
    assert stats["total_items"] == 1


def test_search_skips_deleted_items_and_purges_stale_ids(monkeypatch):
    chroma = FakeChromaClient()
    search = semantic_search.ZoteroSemanticSearch(chroma_client=chroma)

    class FakeReader:
        def __init__(self, db_path=None):
            self.db_path = db_path

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get_item_details_by_key(self, item_key):
            if item_key == "ITEMB002":
                return {
                    "key": item_key,
                    "data": {
                        "title": "Valid Item",
                        "itemType": "report",
                        "creators": [],
                    },
                }
            return None

    monkeypatch.setattr(semantic_search, "LocalZoteroReader", FakeReader)

    results = search.search("valid", limit=5)

    assert [item["item_key"] for item in results["results"]] == ["ITEMB002"]
    assert chroma.deleted_ids == ["STALE001"]


def test_search_rebuilds_when_semantic_index_is_empty(monkeypatch):
    chroma = FakeChromaClient()
    chroma.get_collection_info = lambda: {"count": 0}
    search = semantic_search.ZoteroSemanticSearch(chroma_client=chroma)

    update_calls = []

    def fake_update_database(*, force_full_rebuild=False, limit=None, extract_fulltext=False):
        update_calls.append(
            {
                "force_full_rebuild": force_full_rebuild,
                "limit": limit,
                "extract_fulltext": extract_fulltext,
            }
        )
        chroma.get_collection_info = lambda: {"count": 1}
        return {"total_items": 1}

    class FakeReader:
        def __init__(self, db_path=None):
            self.db_path = db_path

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get_item_count(self):
            return 1

        def get_item_details_by_key(self, item_key):
            return {
                "key": item_key,
                "data": {"title": "Recovered Item", "itemType": "report", "creators": []},
            }

    monkeypatch.setattr(search, "update_database", fake_update_database)
    monkeypatch.setattr(semantic_search, "LocalZoteroReader", FakeReader)

    results = search.search("recovered", limit=5)

    assert update_calls == [
        {
            "force_full_rebuild": True,
            "limit": None,
            "extract_fulltext": False,
        }
    ]
    assert results["results"][0]["item_key"] == "STALE001"


def test_search_rebuilds_when_index_count_differs_from_local_db(monkeypatch):
    chroma = FakeChromaClient()
    chroma.get_collection_info = lambda: {"count": 3}
    search = semantic_search.ZoteroSemanticSearch(chroma_client=chroma)

    update_calls = []

    def fake_update_database(*, force_full_rebuild=False, limit=None, extract_fulltext=False):
        update_calls.append(
            {
                "force_full_rebuild": force_full_rebuild,
                "limit": limit,
                "extract_fulltext": extract_fulltext,
            }
        )
        return {"total_items": 5}

    class FakeReader:
        def __init__(self, db_path=None):
            self.db_path = db_path

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get_item_count(self):
            return 5

        def get_item_details_by_key(self, item_key):
            return {
                "key": item_key,
                "data": {"title": "Valid Item", "itemType": "report", "creators": []},
            }

    monkeypatch.setattr(search, "update_database", fake_update_database)
    monkeypatch.setattr(semantic_search, "LocalZoteroReader", FakeReader)

    search.search("valid", limit=5)

    assert update_calls == [
        {
            "force_full_rebuild": True,
            "limit": None,
            "extract_fulltext": False,
        }
    ]


def test_search_runs_incremental_refresh_when_policy_marks_index_stale(monkeypatch):
    chroma = FakeChromaClient()
    chroma.get_collection_info = lambda: {"count": 3}
    search = semantic_search.ZoteroSemanticSearch(chroma_client=chroma)

    update_calls = []

    def fake_update_database(*, force_full_rebuild=False, limit=None, extract_fulltext=False):
        update_calls.append(
            {
                "force_full_rebuild": force_full_rebuild,
                "limit": limit,
                "extract_fulltext": extract_fulltext,
            }
        )
        return {"total_items": 3}

    class FakeReader:
        def __init__(self, db_path=None):
            self.db_path = db_path

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get_item_count(self):
            return 3

        def get_item_details_by_key(self, item_key):
            return {
                "key": item_key,
                "data": {"title": "Valid Item", "itemType": "report", "creators": []},
            }

    monkeypatch.setattr(search, "update_database", fake_update_database)
    monkeypatch.setattr(search, "should_update_database", lambda: True)
    monkeypatch.setattr(semantic_search, "LocalZoteroReader", FakeReader)

    search.search("valid", limit=5)

    assert update_calls == [
        {
            "force_full_rebuild": False,
            "limit": None,
            "extract_fulltext": False,
        }
    ]
