"""
Local Zotero database reader for semantic search.

Provides direct SQLite access to Zotero's local database for faster semantic search
when running in local mode.
"""

import platform
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any
from dataclasses import dataclass

from .utils import is_local_mode
from .zotero_profile import discover_active_zotero_db_path


@dataclass
class ZoteroItem:
    """Represents a Zotero item with text content for semantic search."""
    item_id: int
    key: str
    item_type_id: int
    item_type: str | None = None
    doi: str | None = None
    title: str | None = None
    abstract: str | None = None
    creators: str | None = None
    fulltext: str | None = None
    fulltext_source: str | None = None  # 'pdf' or 'html'
    notes: str | None = None
    extra: str | None = None
    date_added: str | None = None
    date_modified: str | None = None

    def get_searchable_text(self) -> str:
        """
        Combine all text fields into a single searchable string.

        Returns:
            Combined text content for semantic search indexing.
        """
        parts = []

        if self.title:
            parts.append(f"Title: {self.title}")

        if self.creators:
            parts.append(f"Authors: {self.creators}")

        if self.abstract:
            parts.append(f"Abstract: {self.abstract}")

        if self.extra:
            parts.append(f"Extra: {self.extra}")

        if self.notes:
            parts.append(f"Notes: {self.notes}")

        if self.fulltext:
            # Truncate fulltext to avoid overly long documents
            truncated_fulltext = self.fulltext[:5000] + "..." if len(self.fulltext) > 5000 else self.fulltext
            parts.append(f"Content: {truncated_fulltext}")

        return "\n\n".join(parts)


class LocalZoteroReader:
    """
    Direct SQLite reader for Zotero's local database.

    Provides fast access to item metadata and fulltext for semantic search
    without going through the Zotero API.
    """

    def __init__(self, db_path: str | None = None, pdf_max_pages: int | None = None):
        """
        Initialize the local database reader.

        Args:
            db_path: Optional path to zotero.sqlite. If None, auto-detect.
        """
        self.db_path = db_path or self._find_zotero_db()
        self._connection: sqlite3.Connection | None = None
        self.pdf_max_pages: int | None = pdf_max_pages
        # Reduce noise from pdfminer warnings
        try:
            logging.getLogger("pdfminer").setLevel(logging.ERROR)
        except Exception:
            pass

    def _find_zotero_db(self) -> str:
        """
        Auto-detect the Zotero database location based on OS.

        Returns:
            Path to zotero.sqlite file.

        Raises:
            FileNotFoundError: If database cannot be located.
        """
        explicit_db_path = os.getenv("ZOTERO_LOCAL_DB_PATH")
        if explicit_db_path and Path(explicit_db_path).exists():
            return explicit_db_path

        discovered_db_path = discover_active_zotero_db_path()
        if discovered_db_path:
            return discovered_db_path

        system = platform.system()

        if system == "Darwin":  # macOS
            db_path = Path.home() / "Zotero" / "zotero.sqlite"
        elif system == "Windows":
            # Try Windows 7+ location first
            db_path = Path.home() / "Zotero" / "zotero.sqlite"
            if not db_path.exists():
                # Fallback to XP/2000 location
                db_path = Path(os.path.expanduser("~/Documents and Settings")) / os.getenv("USERNAME", "") / "Zotero" / "zotero.sqlite"
        else:  # Linux and others
            db_path = Path.home() / "Zotero" / "zotero.sqlite"

        if not db_path.exists():
            raise FileNotFoundError(
                f"Zotero database not found at {db_path}. "
                "Please ensure Zotero is installed and has been run at least once."
            )

        return str(db_path)

    def _get_connection(self) -> sqlite3.Connection:
        """Get database connection, creating if needed."""
        if self._connection is None:
            # Use immutable=1 to bypass locking entirely. Zotero uses rollback
            # journal mode and holds a write lock while running, which blocks
            # even read-only connections. immutable=1 skips all lock checks —
            # safe here since we only read and tolerate slightly stale data.
            uri = f"file:{self.db_path}?immutable=1"
            self._connection = sqlite3.connect(uri, uri=True)
            self._connection.row_factory = sqlite3.Row
        return self._connection

    def _get_storage_dir(self) -> Path:
        """Return the Zotero storage directory path based on database location."""
        # Infer storage directory from database path (same parent directory)
        db_parent = Path(self.db_path).parent
        return db_parent / "storage"

    def _iter_parent_attachments(self, parent_item_id: int):
        """Yield tuples (attachment_key, path, content_type) for a parent item."""
        conn = self._get_connection()
        query = (
            """
            SELECT ia.itemID as attachmentItemID,
                   ia.parentItemID as parentItemID,
                   ia.path as path,
                   ia.contentType as contentType,
                   att.key as attachmentKey
            FROM itemAttachments ia
            JOIN items att ON att.itemID = ia.itemID
            WHERE ia.parentItemID = ?
            """
        )
        for row in conn.execute(query, (parent_item_id,)):
            yield row["attachmentKey"], row["path"], row["contentType"]

    def _resolve_attachment_path(self, attachment_key: str, zotero_path: str) -> Path | None:
        """Resolve a Zotero attachment path like 'storage:filename.pdf' to a filesystem path."""
        if not zotero_path:
            return None
        storage_dir = self._get_storage_dir()
        if zotero_path.startswith("storage:"):
            rel = zotero_path.split(":", 1)[1]
            # Handle nested paths if present
            parts = [p for p in rel.split("/") if p]
            return storage_dir / attachment_key / Path(*parts)
        # External links not supported in first pass
        return None

    def _extract_text_from_pdf(self, file_path: Path) -> str:
        """Extract text from a PDF using pdfminer with a page cap to avoid stalls."""
        try:
            from pdfminer.high_level import extract_text  # type: ignore
            # Determine page cap: config value > env > default (10)
            if isinstance(self.pdf_max_pages, int) and self.pdf_max_pages > 0:
                maxpages = self.pdf_max_pages
            else:
                max_pages_env = os.getenv("ZOTERO_PDF_MAXPAGES")
                try:
                    maxpages = int(max_pages_env) if max_pages_env else 10
                except ValueError:
                    maxpages = 10
            text = extract_text(str(file_path), maxpages=maxpages)
            return text or ""
        except Exception:
            return ""

    def _extract_text_from_html(self, file_path: Path) -> str:
        """Extract text from HTML using markitdown if available; fallback to stripping tags."""
        # Try markitdown first
        try:
            from markitdown import MarkItDown
            md = MarkItDown()
            result = md.convert(str(file_path))
            return result.text_content or ""
        except Exception:
            pass
        # Fallback using a simple parser
        try:
            from bs4 import BeautifulSoup  # type: ignore
            html = file_path.read_text(errors="ignore")
            return BeautifulSoup(html, "html.parser").get_text(" ")
        except Exception:
            return ""

    def _extract_text_from_file(self, file_path: Path) -> str:
        """Extract text content from a file based on extension, with fallbacks."""
        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            return self._extract_text_from_pdf(file_path)
        if suffix in {".html", ".htm"}:
            return self._extract_text_from_html(file_path)
        # Generic best-effort
        try:
            return file_path.read_text(errors="ignore")
        except Exception:
            return ""

    def _get_fulltext_meta_for_item(self, item_id: int):
        meta = []
        for key, path, ctype in self._iter_parent_attachments(item_id):
            meta.append([key, path, ctype])

        return meta

    def _extract_fulltext_for_item(self, item_id: int) -> tuple[str, str] | None:
        """Attempt to extract fulltext and source from the item's best attachment.

        Preference: use PDF when available; fall back to HTML when no PDF exists.
        Returns (text, source) where source is 'pdf' or 'html'.
        """
        best_pdf = None
        best_html = None
        for key, path, ctype in self._iter_parent_attachments(item_id):
            resolved = self._resolve_attachment_path(key, path or "")
            if not resolved or not resolved.exists():
                continue
            if ctype == "application/pdf" and best_pdf is None:
                best_pdf = resolved
            elif (ctype or "").startswith("text/html") and best_html is None:
                best_html = resolved
        # Prefer PDF, otherwise fall back to HTML
        target = best_pdf or best_html
        if not target:
            return None
        text = self._extract_text_from_file(target)
        if not text:
            return None
        # Truncate to keep embeddings reasonable
        source = "pdf" if target.suffix.lower() == ".pdf" else ("html" if target.suffix.lower() in {".html", ".htm"} else "file")
        return (text[:10000], source)

    def _resolve_library_id(
        self,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> int:
        libraries = self.get_libraries()

        if library_type == "user":
            if library_id in (None, "", "0", 0):
                for library in libraries:
                    if library["type"] == "user":
                        return int(library["libraryID"])
                raise ValueError("No local user library found in Zotero database")

            for library in libraries:
                if library["type"] == "user" and str(library["libraryID"]) == str(library_id):
                    return int(library["libraryID"])

        elif library_type == "group":
            for library in libraries:
                if library["type"] == "group" and str(library.get("groupID")) == str(library_id):
                    return int(library["libraryID"])

        elif library_type == "feed":
            for library in libraries:
                if library["type"] == "feed" and str(library["libraryID"]) == str(library_id):
                    return int(library["libraryID"])

        raise ValueError(
            f"Could not resolve Zotero library for library_id={library_id!r}, "
            f"library_type={library_type!r}"
        )

    def _get_item_id_by_key(
        self,
        item_key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> int | None:
        resolved_library_id = self._resolve_library_id(library_id, library_type)
        conn = self._get_connection()
        row = conn.execute(
            """
            SELECT itemID
            FROM items
            WHERE libraryID = ? AND key = ?
            """,
            (resolved_library_id, item_key),
        ).fetchone()
        if not row:
            return None
        return int(row["itemID"])

    def _fetch_field_values(self, item_ids: list[int]) -> dict[int, dict[str, str]]:
        if not item_ids:
            return {}

        conn = self._get_connection()
        placeholders = ",".join(["?"] * len(item_ids))
        rows = conn.execute(
            f"""
            SELECT id.itemID, f.fieldName, idv.value
            FROM itemData id
            JOIN fields f ON f.fieldID = id.fieldID
            JOIN itemDataValues idv ON idv.valueID = id.valueID
            WHERE id.itemID IN ({placeholders})
            """,
            item_ids,
        ).fetchall()

        values: dict[int, dict[str, str]] = {item_id: {} for item_id in item_ids}
        for row in rows:
            values[int(row["itemID"])][str(row["fieldName"])] = row["value"]
        return values

    def _fetch_creators(self, item_ids: list[int]) -> dict[int, list[dict[str, str]]]:
        if not item_ids:
            return {}

        conn = self._get_connection()
        placeholders = ",".join(["?"] * len(item_ids))
        rows = conn.execute(
            f"""
            SELECT ic.itemID, ic.orderIndex,
                   ct.creatorType,
                   c.firstName, c.lastName, c.fieldMode
            FROM itemCreators ic
            JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
            JOIN creators c ON c.creatorID = ic.creatorID
            WHERE ic.itemID IN ({placeholders})
            ORDER BY ic.itemID, ic.orderIndex
            """,
            item_ids,
        ).fetchall()

        creators: dict[int, list[dict[str, str]]] = {item_id: [] for item_id in item_ids}
        for row in rows:
            entry: dict[str, str] = {"creatorType": row["creatorType"] or "author"}
            if row["fieldMode"] == 1:
                name = (row["lastName"] or row["firstName"] or "").strip()
                if name:
                    entry["name"] = name
            else:
                if row["firstName"]:
                    entry["firstName"] = row["firstName"]
                if row["lastName"]:
                    entry["lastName"] = row["lastName"]
            creators[int(row["itemID"])].append(entry)
        return creators

    def _fetch_tags(self, item_ids: list[int]) -> dict[int, list[dict[str, str]]]:
        if not item_ids:
            return {}

        conn = self._get_connection()
        placeholders = ",".join(["?"] * len(item_ids))
        rows = conn.execute(
            f"""
            SELECT it.itemID, t.name
            FROM itemTags it
            JOIN tags t ON t.tagID = it.tagID
            WHERE it.itemID IN ({placeholders})
            ORDER BY LOWER(t.name)
            """,
            item_ids,
        ).fetchall()

        tags: dict[int, list[dict[str, str]]] = {item_id: [] for item_id in item_ids}
        for row in rows:
            tags[int(row["itemID"])].append({"tag": row["name"]})
        return tags

    def _fetch_collection_keys(self, item_ids: list[int]) -> dict[int, list[str]]:
        if not item_ids:
            return {}

        conn = self._get_connection()
        placeholders = ",".join(["?"] * len(item_ids))
        rows = conn.execute(
            f"""
            SELECT ci.itemID, c.key
            FROM collectionItems ci
            JOIN collections c ON c.collectionID = ci.collectionID
            WHERE ci.itemID IN ({placeholders})
            ORDER BY ci.orderIndex, c.collectionID
            """,
            item_ids,
        ).fetchall()

        collections: dict[int, list[str]] = {item_id: [] for item_id in item_ids}
        for row in rows:
            collections[int(row["itemID"])].append(row["key"])
        return collections

    def _fetch_child_counts(self, parent_item_ids: list[int]) -> dict[int, int]:
        if not parent_item_ids:
            return {}

        conn = self._get_connection()
        placeholders = ",".join(["?"] * len(parent_item_ids))
        rows = conn.execute(
            f"""
            SELECT parent_item_id, COUNT(*) as child_count
            FROM (
                SELECT parentItemID as parent_item_id FROM itemNotes
                WHERE parentItemID IS NOT NULL
                UNION ALL
                SELECT parentItemID as parent_item_id FROM itemAttachments
                WHERE parentItemID IS NOT NULL
            )
            WHERE parent_item_id IN ({placeholders})
            GROUP BY parent_item_id
            """,
            parent_item_ids,
        ).fetchall()

        counts = {item_id: 0 for item_id in parent_item_ids}
        for row in rows:
            counts[int(row["parent_item_id"])] = int(row["child_count"])
        return counts

    def _hydrate_items(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []

        item_ids = [int(row["itemID"]) for row in rows]
        fields_by_item = self._fetch_field_values(item_ids)
        creators_by_item = self._fetch_creators(item_ids)
        tags_by_item = self._fetch_tags(item_ids)
        collections_by_item = self._fetch_collection_keys(item_ids)
        child_counts = self._fetch_child_counts(item_ids)

        items: list[dict[str, Any]] = []
        for row in rows:
            item_id = int(row["itemID"])
            item_type = row["itemType"]
            field_values = fields_by_item.get(item_id, {})

            title = field_values.get("title") or row["noteTitle"] or ""
            note_text = row["noteText"] or ""
            if item_type == "note" and not title:
                cleaned_note = note_text.strip()
                title = cleaned_note[:80] if cleaned_note else "Untitled Note"
            if item_type == "attachment" and not title:
                title = field_values.get("title") or row["filename"] or "Untitled Attachment"

            data: dict[str, Any] = {
                "key": row["key"],
                "itemType": item_type,
                "title": title,
                "dateAdded": row["dateAdded"],
                "dateModified": row["dateModified"],
                "creators": creators_by_item.get(item_id, []),
                "tags": tags_by_item.get(item_id, []),
                "collections": collections_by_item.get(item_id, []),
            }

            for field_name in (
                "abstractNote",
                "extra",
                "DOI",
                "date",
                "url",
                "publicationTitle",
                "volume",
                "issue",
                "pages",
                "publisher",
                "place",
            ):
                if field_name in field_values:
                    data[field_name] = field_values[field_name]

            if item_type == "note":
                data["note"] = note_text
            if row["parentKey"]:
                data["parentItem"] = row["parentKey"]
            if item_type == "attachment":
                data["contentType"] = row["contentType"] or ""
                data["filename"] = row["filename"] or ""
                data["path"] = row["attachmentPath"] or ""

            items.append(
                {
                    "key": row["key"],
                    "version": 0,
                    "data": data,
                    "meta": {"numChildren": child_counts.get(item_id, 0)},
                }
            )

        return items

    def _normalize_sort_column(self, sort_by: str | None) -> str:
        if not sort_by:
            return "i.dateModified"

        normalized = sort_by.lower()
        if normalized == "dateadded":
            return "i.dateAdded"
        if normalized == "datemodified":
            return "i.dateModified"
        return "i.dateModified"

    def _select_items(
        self,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        include_item_types: set[str] | None = None,
        exclude_item_types: set[str] | None = None,
        parent_item_id: int | None = None,
        filter_top_level: bool = True,
        collection_key: str | None = None,
        limit: int | None = None,
        sort_by: str | None = None,
        sort_direction: str = "desc",
    ) -> list[dict[str, Any]]:
        resolved_library_id = self._resolve_library_id(library_id, library_type)
        conn = self._get_connection()

        where_clauses = ["i.libraryID = ?", "di.itemID IS NULL"]
        params: list[Any] = [resolved_library_id]

        if include_item_types:
            placeholders = ",".join(["?"] * len(include_item_types))
            where_clauses.append(f"it.typeName IN ({placeholders})")
            params.extend(sorted(include_item_types))

        if exclude_item_types:
            placeholders = ",".join(["?"] * len(exclude_item_types))
            where_clauses.append(f"it.typeName NOT IN ({placeholders})")
            params.extend(sorted(exclude_item_types))

        if parent_item_id is None and filter_top_level:
            where_clauses.append("n.parentItemID IS NULL")
            where_clauses.append("a.parentItemID IS NULL")
            where_clauses.append("ann.parentItemID IS NULL")
        elif parent_item_id is not None:
            where_clauses.append(
                "(n.parentItemID = ? OR a.parentItemID = ? OR ann.parentItemID = ?)"
            )
            params.extend([parent_item_id, parent_item_id, parent_item_id])

        join_collection = ""
        if collection_key:
            join_collection = (
                "JOIN collectionItems ci ON ci.itemID = i.itemID "
                "JOIN collections coll ON coll.collectionID = ci.collectionID "
            )
            where_clauses.append("coll.key = ?")
            params.append(collection_key)

        sort_column = self._normalize_sort_column(sort_by)
        sort_keyword = "ASC" if str(sort_direction).lower() == "asc" else "DESC"
        limit_clause = ""
        if isinstance(limit, int) and limit > 0:
            limit_clause = " LIMIT ?"
            params.append(limit)

        query = f"""
        SELECT DISTINCT
            i.itemID,
            i.key,
            i.dateAdded,
            i.dateModified,
            it.typeName AS itemType,
            n.parentItemID AS noteParentItemID,
            pn.key AS parentKeyFromNote,
            n.title AS noteTitle,
            n.note AS noteText,
            a.parentItemID AS attachmentParentItemID,
            pa.key AS parentKeyFromAttachment,
            a.contentType,
            a.path AS attachmentPath,
            ann.parentItemID AS annotationParentItemID,
            pann.key AS parentKeyFromAnnotation
        FROM items i
        JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
        LEFT JOIN deletedItems di ON di.itemID = i.itemID
        LEFT JOIN itemNotes n ON n.itemID = i.itemID
        LEFT JOIN items pn ON pn.itemID = n.parentItemID
        LEFT JOIN itemAttachments a ON a.itemID = i.itemID
        LEFT JOIN items pa ON pa.itemID = a.parentItemID
        LEFT JOIN itemAnnotations ann ON ann.itemID = i.itemID
        LEFT JOIN items pann ON pann.itemID = ann.parentItemID
        {join_collection}
        WHERE {" AND ".join(where_clauses)}
        ORDER BY {sort_column} {sort_keyword}, i.itemID DESC
        {limit_clause}
        """

        rows = conn.execute(query, params).fetchall()
        normalized_rows: list[sqlite3.Row] = []
        for row in rows:
            row_dict = dict(row)
            row_dict["parentKey"] = (
                row_dict.get("parentKeyFromNote")
                or row_dict.get("parentKeyFromAttachment")
                or row_dict.get("parentKeyFromAnnotation")
            )
            attachment_path = row_dict.get("attachmentPath") or ""
            if attachment_path:
                if attachment_path.startswith("storage:"):
                    row_dict["filename"] = attachment_path.split(":", 1)[1].split("/")[-1]
                else:
                    row_dict["filename"] = Path(attachment_path).name
            else:
                row_dict["filename"] = ""
            normalized_rows.append(row_dict)
        return self._hydrate_items(normalized_rows)

    def close(self):
        """Close database connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def get_libraries(self) -> list[dict[str, Any]]:
        """Get all libraries (user, group, feed) from the database."""
        conn = self._get_connection()
        rows = conn.execute(
            """
            SELECT l.libraryID, l.type, l.editable,
                   g.groupID, g.name as groupName, g.description as groupDescription,
                   f.name as feedName, f.url as feedUrl,
                   f.lastCheck as feedLastCheck, f.lastUpdate as feedLastUpdate,
                   (SELECT COUNT(*) FROM items i
                    JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
                    WHERE i.libraryID = l.libraryID
                    AND it.typeName NOT IN ('attachment', 'note', 'annotation')) as itemCount
            FROM libraries l
            LEFT JOIN groups g ON l.libraryID = g.libraryID
            LEFT JOIN feeds f ON l.libraryID = f.libraryID
            ORDER BY l.type, l.libraryID
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_groups(self) -> list[dict[str, Any]]:
        """Get all group libraries with item counts."""
        conn = self._get_connection()
        rows = conn.execute(
            """
            SELECT g.groupID, g.libraryID, g.name, g.description,
                   (SELECT COUNT(*) FROM items i
                    JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
                    WHERE i.libraryID = g.libraryID
                    AND it.typeName NOT IN ('attachment', 'note', 'annotation')) as itemCount
            FROM groups g
            ORDER BY g.name
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_feeds(self) -> list[dict[str, Any]]:
        """Get all RSS feed subscriptions with item counts."""
        conn = self._get_connection()
        rows = conn.execute(
            """
            SELECT f.libraryID, f.name, f.url,
                   f.lastCheck, f.lastUpdate, f.lastCheckError,
                   f.refreshInterval,
                   (SELECT COUNT(*) FROM feedItems fi
                    JOIN items i ON fi.itemID = i.itemID
                    WHERE i.libraryID = f.libraryID) as itemCount
            FROM feeds f
            ORDER BY f.name
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_feed_items(
        self, library_id: int, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Get items from a specific RSS feed by its libraryID."""
        conn = self._get_connection()
        rows = conn.execute(
            """
            SELECT i.itemID, i.key, it.typeName as itemType,
                   i.dateAdded,
                   fi.readTime, fi.translatedTime,
                   title_val.value as title,
                   abstract_val.value as abstract,
                   url_val.value as url,
                   GROUP_CONCAT(
                       CASE
                           WHEN c.firstName IS NOT NULL AND c.lastName IS NOT NULL
                           THEN c.lastName || ', ' || c.firstName
                           WHEN c.lastName IS NOT NULL THEN c.lastName
                           ELSE NULL
                       END, '; '
                   ) as creators
            FROM feedItems fi
            JOIN items i ON fi.itemID = i.itemID
            JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
            LEFT JOIN itemData title_data ON i.itemID = title_data.itemID AND title_data.fieldID = 1
            LEFT JOIN itemDataValues title_val ON title_data.valueID = title_val.valueID
            LEFT JOIN itemData abstract_data ON i.itemID = abstract_data.itemID AND abstract_data.fieldID = 2
            LEFT JOIN itemDataValues abstract_val ON abstract_data.valueID = abstract_val.valueID
            LEFT JOIN fields url_f ON url_f.fieldName = 'url'
            LEFT JOIN itemData url_data ON i.itemID = url_data.itemID AND url_data.fieldID = url_f.fieldID
            LEFT JOIN itemDataValues url_val ON url_data.valueID = url_val.valueID
            LEFT JOIN itemCreators ic ON i.itemID = ic.itemID
            LEFT JOIN creators c ON ic.creatorID = c.creatorID
            WHERE i.libraryID = ?
            GROUP BY i.itemID
            ORDER BY i.dateAdded DESC
            LIMIT ?
            """,
            (library_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_item_count(self) -> int:
        """
        Get total count of non-attachment items.

        Returns:
            Number of items in the library.
        """
        conn = self._get_connection()
        cursor = conn.execute(
            """
            SELECT COUNT(*)
            FROM items i
            JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
            WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
            """
        )
        return cursor.fetchone()[0]

    def get_items_with_text(self, limit: int | None = None, include_fulltext: bool = False) -> list[ZoteroItem]:
        """
        Get all items with their text content for semantic search.

        Args:
            limit: Optional limit on number of items to return.

        Returns:
            List of ZoteroItem objects with text content.
        """
        conn = self._get_connection()

        # Query to get items with their text content (simplified for now)
        query = """
        SELECT
            i.itemID,
            i.key,
            i.itemTypeID,
            it.typeName as item_type,
            i.dateAdded,
            i.dateModified,
            title_val.value as title,
            abstract_val.value as abstract,
            extra_val.value as extra,
            doi_val.value as doi,
            GROUP_CONCAT(n.note, ' ') as notes,
            GROUP_CONCAT(
                CASE
                    WHEN c.firstName IS NOT NULL AND c.lastName IS NOT NULL
                    THEN c.lastName || ', ' || c.firstName
                    WHEN c.lastName IS NOT NULL
                    THEN c.lastName
                    ELSE NULL
                END, '; '
            ) as creators
        FROM items i
        JOIN itemTypes it ON i.itemTypeID = it.itemTypeID

        -- Get title
        LEFT JOIN itemData title_data ON i.itemID = title_data.itemID AND title_data.fieldID = 1
        LEFT JOIN itemDataValues title_val ON title_data.valueID = title_val.valueID

        -- Get abstract
        LEFT JOIN itemData abstract_data ON i.itemID = abstract_data.itemID AND abstract_data.fieldID = 2
        LEFT JOIN itemDataValues abstract_val ON abstract_data.valueID = abstract_val.valueID

        -- Get extra field
        LEFT JOIN itemData extra_data ON i.itemID = extra_data.itemID AND extra_data.fieldID = 16
        LEFT JOIN itemDataValues extra_val ON extra_data.valueID = extra_val.valueID

        -- Get DOI field via fields table
        LEFT JOIN fields doi_f ON doi_f.fieldName = 'DOI'
        LEFT JOIN itemData doi_data ON i.itemID = doi_data.itemID AND doi_data.fieldID = doi_f.fieldID
        LEFT JOIN itemDataValues doi_val ON doi_data.valueID = doi_val.valueID

        -- Get notes
        LEFT JOIN itemNotes n ON i.itemID = n.parentItemID OR i.itemID = n.itemID

        -- Get creators
        LEFT JOIN itemCreators ic ON i.itemID = ic.itemID
        LEFT JOIN creators c ON ic.creatorID = c.creatorID

        WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')

        GROUP BY i.itemID, i.key, i.itemTypeID, it.typeName, i.dateAdded, i.dateModified,
                 title_val.value, abstract_val.value, extra_val.value

        ORDER BY i.dateModified DESC
        """

        if limit:
            query += f" LIMIT {limit}"

        cursor = conn.execute(query)
        items = []

        for row in cursor:
            item = ZoteroItem(
                item_id=row['itemID'],
                key=row['key'],
                item_type_id=row['itemTypeID'],
                item_type=row['item_type'],
                doi=row['doi'],
                title=row['title'],
                abstract=row['abstract'],
                creators=row['creators'],
                fulltext=(res := (self._extract_fulltext_for_item(row['itemID']) if include_fulltext else None)) and res[0],
                fulltext_source=res[1] if include_fulltext and res else None,
                notes=row['notes'],
                extra=row['extra'],
                date_added=row['dateAdded'],
                date_modified=row['dateModified']
            )
            items.append(item)

        return items

    def get_items(
        self,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        include_item_types: set[str] | None = None,
        exclude_item_types: set[str] | None = None,
        limit: int | None = None,
        sort_by: str | None = None,
        sort_direction: str = "desc",
    ) -> list[dict[str, Any]]:
        return self._select_items(
            library_id=library_id,
            library_type=library_type,
            include_item_types=include_item_types,
            exclude_item_types=exclude_item_types or {"attachment", "note", "annotation"},
            limit=limit,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )

    def get_item_details_by_key(
        self,
        key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> dict[str, Any] | None:
        resolved_library_id = self._resolve_library_id(library_id, library_type)
        conn = self._get_connection()
        rows = conn.execute(
            """
            SELECT DISTINCT
                i.itemID,
                i.key,
                i.dateAdded,
                i.dateModified,
                it.typeName AS itemType,
                n.parentItemID AS noteParentItemID,
                pn.key AS parentKeyFromNote,
                n.title AS noteTitle,
                n.note AS noteText,
                a.parentItemID AS attachmentParentItemID,
                pa.key AS parentKeyFromAttachment,
                a.contentType,
                a.path AS attachmentPath,
                ann.parentItemID AS annotationParentItemID,
                pann.key AS parentKeyFromAnnotation
            FROM items i
            JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
            LEFT JOIN deletedItems di ON di.itemID = i.itemID
            LEFT JOIN itemNotes n ON n.itemID = i.itemID
            LEFT JOIN items pn ON pn.itemID = n.parentItemID
            LEFT JOIN itemAttachments a ON a.itemID = i.itemID
            LEFT JOIN items pa ON pa.itemID = a.parentItemID
            LEFT JOIN itemAnnotations ann ON ann.itemID = i.itemID
            LEFT JOIN items pann ON pann.itemID = ann.parentItemID
            WHERE i.libraryID = ? AND i.key = ? AND di.itemID IS NULL
            LIMIT 1
            """,
            (resolved_library_id, key),
        ).fetchall()
        if not rows:
            return None

        normalized_rows: list[dict[str, Any]] = []
        for row in rows:
            row_dict = dict(row)
            row_dict["parentKey"] = (
                row_dict.get("parentKeyFromNote")
                or row_dict.get("parentKeyFromAttachment")
                or row_dict.get("parentKeyFromAnnotation")
            )
            attachment_path = row_dict.get("attachmentPath") or ""
            if attachment_path:
                if attachment_path.startswith("storage:"):
                    row_dict["filename"] = attachment_path.split(":", 1)[1].split("/")[-1]
                else:
                    row_dict["filename"] = Path(attachment_path).name
            else:
                row_dict["filename"] = ""
            normalized_rows.append(row_dict)

        hydrated = self._hydrate_items(normalized_rows)
        return hydrated[0] if hydrated else None

    def get_collection_by_key(
        self,
        collection_key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> dict[str, Any] | None:
        collections = self.get_collections(library_id=library_id, library_type=library_type)
        for collection in collections:
            if collection["key"] == collection_key:
                return collection
        return None

    def get_collections(
        self,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        resolved_library_id = self._resolve_library_id(library_id, library_type)
        conn = self._get_connection()
        params: list[Any] = [resolved_library_id]
        limit_clause = ""
        if isinstance(limit, int) and limit > 0:
            limit_clause = " LIMIT ?"
            params.append(limit)

        rows = conn.execute(
            f"""
            SELECT
                c.collectionID,
                c.key,
                c.collectionName AS name,
                c.parentCollectionID,
                p.key AS parentKey,
                p.collectionName AS parentName,
                c.libraryID,
                (
                    SELECT COUNT(*)
                    FROM collectionItems ci
                    JOIN items i ON i.itemID = ci.itemID
                    JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
                    LEFT JOIN deletedItems di ON di.itemID = i.itemID
                    WHERE ci.collectionID = c.collectionID
                      AND di.itemID IS NULL
                      AND it.typeName NOT IN ('attachment', 'note', 'annotation')
                ) AS itemCount
            FROM collections c
            LEFT JOIN collections p ON p.collectionID = c.parentCollectionID
            WHERE c.libraryID = ?
            ORDER BY LOWER(c.collectionName), c.collectionID
            {limit_clause}
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def get_collection_items(
        self,
        collection_key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self._select_items(
            library_id=library_id,
            library_type=library_type,
            exclude_item_types={"attachment", "note", "annotation"},
            collection_key=collection_key,
            limit=limit,
            sort_by="dateModified",
            sort_direction="desc",
        )

    def get_item_children(
        self,
        item_key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> list[dict[str, Any]]:
        parent_item_id = self._get_item_id_by_key(
            item_key, library_id=library_id, library_type=library_type
        )
        if parent_item_id is None:
            return []
        return self._select_items(
            library_id=library_id,
            library_type=library_type,
            include_item_types={"attachment", "note"},
            parent_item_id=parent_item_id,
            sort_by="dateModified",
            sort_direction="desc",
        )

    def get_recent_items(
        self,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        return self.get_items(
            library_id=library_id,
            library_type=library_type,
            limit=limit,
            sort_by="dateAdded",
            sort_direction="desc",
        )

    def get_all_tags(
        self,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
        limit: int | None = None,
    ) -> list[str]:
        resolved_library_id = self._resolve_library_id(library_id, library_type)
        conn = self._get_connection()
        params: list[Any] = [resolved_library_id]
        limit_clause = ""
        if isinstance(limit, int) and limit > 0:
            limit_clause = " LIMIT ?"
            params.append(limit)

        rows = conn.execute(
            f"""
            SELECT DISTINCT t.name
            FROM tags t
            JOIN itemTags it ON it.tagID = t.tagID
            JOIN items i ON i.itemID = it.itemID
            LEFT JOIN deletedItems di ON di.itemID = i.itemID
            WHERE i.libraryID = ? AND di.itemID IS NULL
            ORDER BY LOWER(t.name)
            {limit_clause}
            """,
            params,
        ).fetchall()
        return [row["name"] for row in rows]

    def get_notes(
        self,
        *,
        item_key: str | None = None,
        library_id: str | int | None = None,
        library_type: str = "user",
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        parent_item_id = None
        if item_key:
            parent_item_id = self._get_item_id_by_key(
                item_key, library_id=library_id, library_type=library_type
            )
            if parent_item_id is None:
                return []

        return self._select_items(
            library_id=library_id,
            library_type=library_type,
            include_item_types={"note"},
            parent_item_id=parent_item_id if item_key else None,
            filter_top_level=False,
            limit=limit,
            sort_by="dateModified",
            sort_direction="desc",
        )

    # Public helper to quickly check full text metadata for item
    def get_fulltext_meta_for_item(self, item_id: int) -> tuple[str, str] | None:
        return self._get_fulltext_meta_for_item(item_id)

    # Public helper to extract fulltext on demand for a specific item
    def extract_fulltext_for_item(self, item_id: int) -> tuple[str, str] | None:
        return self._extract_fulltext_for_item(item_id)

    def extract_fulltext_for_item_key(
        self,
        item_key: str,
        *,
        library_id: str | int | None = None,
        library_type: str = "user",
    ) -> tuple[str, str] | None:
        item_id = self._get_item_id_by_key(
            item_key, library_id=library_id, library_type=library_type
        )
        if item_id is None:
            return None
        return self._extract_fulltext_for_item(item_id)

    def get_item_by_key(self, key: str) -> ZoteroItem | None:
        """
        Get a specific item by its Zotero key.

        Args:
            key: The Zotero item key.

        Returns:
            ZoteroItem if found, None otherwise.
        """
        items = self.get_items_with_text()
        for item in items:
            if item.key == key:
                return item
        return None

    def search_items_by_text(self, query: str, limit: int = 50) -> list[ZoteroItem]:
        """
        Simple text search through item content.

        Args:
            query: Search query string.
            limit: Maximum number of results.

        Returns:
            List of matching ZoteroItem objects.
        """
        items = self.get_items_with_text()
        matching_items = []

        query_lower = query.lower()

        for item in items:
            searchable_text = item.get_searchable_text().lower()
            if query_lower in searchable_text:
                matching_items.append(item)
                if len(matching_items) >= limit:
                    break

        return matching_items


def get_local_zotero_reader() -> LocalZoteroReader | None:
    """
    Get a LocalZoteroReader instance if in local mode.

    Returns:
        LocalZoteroReader instance if in local mode and database exists,
        None otherwise.
    """
    if not is_local_mode():
        return None

    try:
        return LocalZoteroReader()
    except FileNotFoundError:
        return None


def is_local_db_available() -> bool:
    """
    Check if local Zotero database is available.

    Returns:
        True if local database can be accessed, False otherwise.
    """
    reader = get_local_zotero_reader()
    if reader:
        reader.close()
        return True
    return False
