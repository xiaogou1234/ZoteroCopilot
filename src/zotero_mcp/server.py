"""
Zotero MCP server implementation.

Note: ChatGPT requires specific tool names "search" and "fetch", and so they
are defined and used and piped through to the main server tools. See bottom of file for details.
"""

from typing import Any, Dict, List, Literal, Optional, Union
import os
import sys
import uuid
import json
import re
from contextlib import asynccontextmanager

from fastmcp import Context, FastMCP

from zotero_mcp.client import (
    clear_active_library,
    format_item_metadata,
    generate_bibtex,
    get_active_library,
    set_active_library,
)
from zotero_mcp.desktop_bridge_client import DesktopBridgeClient, DesktopBridgeError
from zotero_mcp.import_buffer import ImportBufferError, StagedPDF, collect_pdf_paths, stage_pdf_into_buffer
from zotero_mcp.local_db import LocalZoteroReader

from zotero_mcp.utils import clean_html, format_creators, matches_search_query

@asynccontextmanager
async def server_lifespan(server: FastMCP):
    """Manage server startup and shutdown lifecycle."""
    sys.stderr.write("Starting Zotero MCP server...\n")

    yield {}

    sys.stderr.write("Shutting down Zotero MCP server...\n")


# Create an MCP server (fastmcp 2.14+ no longer accepts `dependencies`)
mcp = FastMCP("Zotero", lifespan=server_lifespan)


def get_desktop_bridge_client() -> DesktopBridgeClient:
    """Create a bridge client from the current environment."""
    return DesktopBridgeClient.from_env()


def _bridge_success(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Attach a stable operation name to successful bridge responses."""
    result = dict(payload)
    result.setdefault("ok", True)
    result.setdefault("operation", operation)
    return result


def _bridge_failure(operation: str, error: Exception) -> dict[str, Any]:
    """Normalize bridge failures for MCP clients."""
    if isinstance(error, DesktopBridgeError):
        error_payload = error.to_dict()
    else:
        error_payload = {"code": "UNEXPECTED_ERROR", "message": str(error)}

    return {
        "ok": False,
        "operation": operation,
        "error": error_payload,
    }


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _desktop_bridge_buffer_directory(client: DesktopBridgeClient) -> str:
    capabilities = client.capabilities(verbose=False)
    buffer_directory = _clean_optional_text(capabilities.get("bufferDirectory"))
    if not buffer_directory:
        raise DesktopBridgeError(
            "BUFFER_DIRECTORY_NOT_CONFIGURED",
            "Configure a buffer directory in the Zero MCP Plugin settings before importing PDFs.",
            status_code=503,
            payload=capabilities,
        )
    return buffer_directory


def _stage_pdf_for_bridge_import(
    client: DesktopBridgeClient,
    file_path: str,
) -> StagedPDF:
    try:
        buffer_directory = _desktop_bridge_buffer_directory(client)
        return stage_pdf_into_buffer(file_path, buffer_directory)
    except ImportBufferError as error:
        raise DesktopBridgeError("BUFFER_STAGE_FAILED", str(error), status_code=400) from error


def _cleanup_staged_previews(staged_pdfs: list[StagedPDF]) -> None:
    for staged_pdf in staged_pdfs:
        try:
            staged_pdf.cleanup_if_temporary()
        except OSError:
            continue


def _active_library_context() -> dict[str, str]:
    override = get_active_library()
    if override:
        return {
            "library_id": override.get("library_id", "0"),
            "library_type": override.get("library_type", "user"),
        }

    return {
        "library_id": os.getenv("ZOTERO_LIBRARY_ID", "0"),
        "library_type": os.getenv("ZOTERO_LIBRARY_TYPE", "user"),
    }


def _reader_kwargs() -> dict[str, str]:
    return _active_library_context()


def _normalize_limit(
    limit: int | str | None,
    *,
    default: int,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    if isinstance(limit, str):
        limit = int(limit)
    if limit is None:
        limit = default
    if limit < minimum:
        return default
    if maximum is not None and limit > maximum:
        return maximum
    return limit


def _format_local_reader_item_summary(item: Any, item_key: str) -> str:
    title = getattr(item, "title", None) or f"Item {item_key}"
    item_type = getattr(item, "item_type", None) or "unknown"
    lines = [
        f"# {title}",
        f"**Type:** {item_type}",
        f"**Item Key:** {item_key}",
    ]

    date = getattr(item, "date", None)
    if date:
        lines.append(f"**Date:** {date}")

    creators = getattr(item, "creators", None)
    if creators:
        lines.append(f"**Authors:** {creators}")

    doi = getattr(item, "doi", None)
    if doi:
        lines.append(f"**DOI:** {doi}")

    tags = getattr(item, "tags", None) or []
    if tags:
        lines.append(f"**Tags:** {' '.join(f'`{tag}`' for tag in tags)}")

    abstract = getattr(item, "abstract", None)
    if abstract:
        lines.extend(["", "## Abstract", abstract])

    return "\n".join(lines)


def _matches_item_type_filter(item: dict[str, Any], item_type: str | None) -> bool:
    if not item_type:
        return True

    actual_item_type = item.get("data", {}).get("itemType", "")
    if item_type.startswith("-"):
        return actual_item_type != item_type[1:]
    return actual_item_type == item_type


def _matches_tag_conditions(item_tags: list[dict[str, Any]], conditions: list[str]) -> bool:
    normalized_tags = {str(tag.get("tag", "")).strip().lower() for tag in item_tags if tag.get("tag")}
    for raw_condition in conditions:
        condition = str(raw_condition or "").strip()
        if not condition:
            continue

        negated = condition.startswith("-")
        expression = condition[1:].strip() if negated else condition
        options = [option.strip().lower() for option in re.split(r"\s+OR\s+", expression, flags=re.IGNORECASE)]
        options = [option for option in options if option]
        if not options:
            continue

        matched = any(option in normalized_tags for option in options)
        if negated and matched:
            return False
        if not negated and not matched:
            return False
    return True


def _item_matches_query(item: dict[str, Any], query: str, qmode: str) -> bool:
    data = item.get("data", {})
    search_fields = [
        data.get("title", ""),
        format_creators(data.get("creators", [])),
        data.get("date", ""),
    ]

    if qmode == "everything":
        search_fields.extend(
            [
                data.get("abstractNote", ""),
                data.get("extra", ""),
                " ".join(tag.get("tag", "") for tag in data.get("tags", [])),
                clean_html(data.get("note", "")),
            ]
        )

    return matches_search_query(search_fields, query)


def _search_local_items(
    reader: LocalZoteroReader,
    *,
    query: str,
    qmode: str,
    limit: int,
    item_type: str | None = None,
    tag_conditions: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Search local Zotero items with metadata-first matching and fulltext fallback."""
    candidates = reader.get_items(limit=None, **_reader_kwargs())
    candidate_by_key = {item.get("key"): item for item in candidates if item.get("key")}
    tag_conditions = tag_conditions or []

    results: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for item in candidates:
        if item_type is not None and not _matches_item_type_filter(item, item_type):
            continue
        if tag_conditions and not _matches_tag_conditions(item.get("data", {}).get("tags", []), tag_conditions):
            continue
        if not _item_matches_query(item, query, qmode):
            continue

        item_key = item.get("key")
        if not item_key or item_key in seen_keys:
            continue
        results.append(item)
        seen_keys.add(item_key)
        if len(results) >= limit:
            return results

    fulltext_lookup = getattr(reader, "search_item_keys_by_fulltext", None)
    if not callable(fulltext_lookup):
        return results

    fallback_limit = max(limit * 3, limit)
    for item_key in fulltext_lookup(query, **_reader_kwargs(), limit=fallback_limit):
        if not item_key or item_key in seen_keys:
            continue

        item = candidate_by_key.get(item_key)
        if item is None:
            get_item_details = getattr(reader, "get_item_details_by_key", None)
            if callable(get_item_details):
                item = get_item_details(item_key, **_reader_kwargs())
        if not item:
            continue
        if item_type is not None and not _matches_item_type_filter(item, item_type):
            continue
        if tag_conditions and not _matches_tag_conditions(item.get("data", {}).get("tags", []), tag_conditions):
            continue

        results.append(item)
        seen_keys.add(item_key)
        if len(results) >= limit:
            break

    return results


def _format_item_summary(item: dict[str, Any], index: int, *, include_abstract: bool = False) -> list[str]:
    data = item.get("data", {})
    lines = [
        f"## {index}. {data.get('title', 'Untitled')}",
        f"**Type:** {data.get('itemType', 'unknown')}",
        f"**Item Key:** {item.get('key', '')}",
        f"**Date:** {data.get('date', 'No date')}",
        f"**Authors:** {format_creators(data.get('creators', []))}",
    ]

    if include_abstract and data.get("abstractNote"):
        abstract = data["abstractNote"]
        snippet = abstract[:200] + "..." if len(abstract) > 200 else abstract
        lines.append(f"**Abstract:** {snippet}")

    tags = [f"`{tag['tag']}`" for tag in data.get("tags", []) if tag.get("tag")]
    if tags:
        lines.append(f"**Tags:** {' '.join(tags)}")

    lines.append("")
    return lines


def _collection_path(collection: dict[str, Any], collection_lookup: dict[str, dict[str, Any]]) -> str:
    names = [collection["name"]]
    parent_key = collection.get("parentKey")
    while parent_key:
        parent = collection_lookup.get(parent_key)
        if not parent:
            break
        names.insert(0, parent["name"])
        parent_key = parent.get("parentKey")
    return "/".join(names)


def _local_note_text(item: dict[str, Any], truncate: bool = False) -> str:
    note_text = clean_html(item.get("data", {}).get("note", ""))
    if truncate and len(note_text) > 500:
        return note_text[:500] + "..."
    return note_text


@mcp.tool(
    name="zotero_search_items",
    description="Search for items in your Zotero library, given a query string."
)
def search_items(
    query: str,
    qmode: Literal["titleCreatorYear", "everything"] = "titleCreatorYear",
    item_type: str = "-attachment",  # Exclude attachments by default
    limit: int | str | None = 10,
    tag: list[str] | None = None,
    *,
    ctx: Context
) -> str:
    """
    Search for items in your Zotero library.

    Args:
        query: Search query string
        qmode: Query mode (titleCreatorYear or everything)
        item_type: Type of items to search for. Use "-attachment" to exclude attachments.
        limit: Maximum number of results to return
        tag: List of tags conditions to filter by
        ctx: MCP context

    Returns:
        Markdown-formatted search results
    """
    try:
        if not query.strip():
            return "Error: Search query cannot be empty"

        tag_condition_str = ""
        if tag:
            tag_condition_str = f" with tags: '{', '.join(tag)}'"
        else:
            tag = []

        ctx.info(f"Searching Zotero for '{query}'{tag_condition_str}")
        limit = _normalize_limit(limit, default=10, maximum=200)

        with LocalZoteroReader() as reader:
            results = _search_local_items(
                reader,
                query=query,
                qmode=qmode,
                limit=limit,
                item_type=item_type,
                tag_conditions=tag,
            )

        if not results:
            return f"No items found matching query: '{query}'{tag_condition_str}"

        # Format results as markdown
        output = [f"# Search Results for '{query}'", f"{tag_condition_str}", ""]

        for i, item in enumerate(results, 1):
            output.extend(_format_item_summary(item, i, include_abstract=True))

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error searching Zotero: {str(e)}")
        return f"Error searching Zotero: {str(e)}"

@mcp.tool(
    name="zotero_search_by_tag",
    description="Search for items in your Zotero library by tag. "
    "Conditions are ANDed, each term supports disjunction (`OR`) and exclusion (`-`)."
)
def search_by_tag(
    tag: list[str],
    item_type: str = "-attachment",
    limit: int | str | None = 10,
    *,
    ctx: Context
) -> str:
    """
    Search for items in your Zotero library by tag.
    Conditions are ANDed, each term supports disjunction (`OR`) and exclusion (`-`).

    Args:
        tag: List of tag conditions. Items are returned only if they satisfy
            ALL conditions in the list. Each tag condition can be expressed
            in two ways:
                As alternatives: tag1 OR tag2 (matches items with either tag1 OR tag2)
                As exclusions: -tag (matches items that do NOT have this tag)
            For example, a tag field with ["research OR important", "-draft"] would
            return items that:
                Have either "research" OR "important" tags, AND
                Do NOT have the "draft" tag
        item_type: Type of items to search for. Use "-attachment" to exclude attachments.
        limit: Maximum number of results to return
        ctx: MCP context

    Returns:
        Markdown-formatted search results
    """
    try:
        if not tag:
            return "Error: Tag cannot be empty"

        ctx.info(f"Searching Zotero for tag '{tag}'")
        limit = _normalize_limit(limit, default=10, maximum=200)

        with LocalZoteroReader() as reader:
            candidates = reader.get_items(limit=None, **_reader_kwargs())

        results = [
            item
            for item in candidates
            if _matches_item_type_filter(item, item_type)
            and _matches_tag_conditions(item.get("data", {}).get("tags", []), tag)
        ][:limit]

        if not results:
            return f"No items found with tag: '{tag}'"

        # Format results as markdown
        output = [f"# Search Results for Tag: '{tag}'", ""]

        for i, item in enumerate(results, 1):
            output.extend(_format_item_summary(item, i, include_abstract=True))

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error searching Zotero: {str(e)}")
        return f"Error searching Zotero: {str(e)}"

@mcp.tool(
    name="zotero_get_item_metadata",
    description="Get detailed metadata for a specific Zotero item by its key."
)
def get_item_metadata(
    item_key: str,
    include_abstract: bool = True,
    format: Literal["markdown", "bibtex"] = "markdown",
    *,
    ctx: Context
) -> str:
    """
    Get detailed metadata for a Zotero item.

    Args:
        item_key: Zotero item key/ID
        include_abstract: Whether to include the abstract in the output (markdown format only)
        format: Output format - 'markdown' for detailed metadata or 'bibtex' for BibTeX citation
        ctx: MCP context

    Returns:
        Formatted item metadata (markdown or BibTeX)
    """
    try:
        ctx.info(f"Fetching metadata for item {item_key} in {format} format")
        with LocalZoteroReader() as reader:
            item = reader.get_item_details_by_key(item_key, **_reader_kwargs())
        if not item:
            return f"No item found with key: {item_key}"

        if format == "bibtex":
            return generate_bibtex(item)
        else:
            return format_item_metadata(item, include_abstract)

    except Exception as e:
        ctx.error(f"Error fetching item metadata: {str(e)}")
        return f"Error fetching item metadata: {str(e)}"


@mcp.tool(
    name="zotero_get_item_fulltext",
    description="Get the full text content of a Zotero item by its key."
)
def get_item_fulltext(
    item_key: str,
    *,
    ctx: Context
) -> str:
    """
    Get the full text content of a Zotero item.

    Args:
        item_key: Zotero item key/ID
        ctx: MCP context

    Returns:
        Markdown-formatted item full text
    """
    try:
        ctx.info(f"Fetching full text for item {item_key}")
        with LocalZoteroReader() as reader:
            full_text = reader.extract_fulltext_for_item_key(item_key, **_reader_kwargs())
            item = reader.get_item_details_by_key(item_key, **_reader_kwargs())
            if item:
                metadata = format_item_metadata(item, include_abstract=True)
            else:
                fallback_item = reader.get_item_by_key(item_key)
                metadata = (
                    _format_local_reader_item_summary(fallback_item, item_key)
                    if fallback_item
                    else None
                )

        if not metadata and not full_text:
            return f"No item found with key: {item_key}"
        if not full_text:
            return f"{metadata or f'# Item {item_key}'}\n\n---\n\nNo suitable attachment found for this item."

        return f"{metadata or f'# Item {item_key}'}\n\n---\n\n## Full Text\n\n{full_text[0]}"

    except Exception as e:
        ctx.error(f"Error fetching item full text: {str(e)}")
        return f"Error fetching item full text: {str(e)}"


@mcp.tool(
    name="zotero_get_collections",
    description="List all collections in your Zotero library."
)
def get_collections(
    limit: int | str | None = None,
    *,
    ctx: Context
) -> str:
    """
    List all collections in your Zotero library.

    Args:
        limit: Maximum number of collections to return
        ctx: MCP context

    Returns:
        Markdown-formatted list of collections
    """
    try:
        ctx.info("Fetching collections")
        limit = _normalize_limit(limit, default=100, maximum=500) if limit is not None else None

        with LocalZoteroReader() as reader:
            collections = reader.get_collections(limit=limit, **_reader_kwargs())

        # Always return the header, even if empty
        output = ["# Zotero Collections", ""]

        if not collections:
            output.append("No collections found in your Zotero library.")
            return "\n".join(output)

        # Create a mapping of collection IDs to their data
        collection_map = {c["key"]: c for c in collections}

        # Create a mapping of parent to child collections
        hierarchy = {}
        for coll in collections:
            parent_key = coll.get("parentKey") or None
            if parent_key not in hierarchy:
                hierarchy[parent_key] = []
            hierarchy[parent_key].append(coll["key"])

        # Function to recursively format collections
        def format_collection(key, level=0):
            if key not in collection_map:
                return []

            coll = collection_map[key]
            name = coll.get("name", "Unnamed Collection")

            # Create indentation for hierarchy
            indent = "  " * level
            lines = [f"{indent}- **{name}** (Key: {key})"]

            # Add children if they exist
            child_keys = hierarchy.get(key, [])
            for child_key in sorted(child_keys):  # Sort for consistent output
                lines.extend(format_collection(child_key, level + 1))

            return lines

        # Start with top-level collections (those with None as parent)
        top_level_keys = hierarchy.get(None, [])

        if not top_level_keys:
            # If no clear hierarchy, just list all collections
            output.append("Collections (flat list):")
            for coll in sorted(collections, key=lambda x: x.get("name", "")):
                name = coll.get("name", "Unnamed Collection")
                key = coll["key"]
                output.append(f"- **{name}** (Key: {key})")
        else:
            # Display hierarchical structure
            for key in sorted(top_level_keys):
                output.extend(format_collection(key))

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching collections: {str(e)}")
        error_msg = f"Error fetching collections: {str(e)}"
        return f"# Zotero Collections\n\n{error_msg}"


@mcp.tool(
    name="zotero_get_collection_items",
    description="Get all items in a specific Zotero collection."
)
def get_collection_items(
    collection_key: str,
    limit: int | str | None = 50,
    *,
    ctx: Context
) -> str:
    """
    Get all items in a specific Zotero collection.

    Args:
        collection_key: The collection key/ID
        limit: Maximum number of items to return
        ctx: MCP context

    Returns:
        Markdown-formatted list of items in the collection
    """
    try:
        ctx.info(f"Fetching items for collection {collection_key}")
        limit = _normalize_limit(limit, default=50, maximum=500)

        with LocalZoteroReader() as reader:
            collection = reader.get_collection_by_key(collection_key, **_reader_kwargs())
            collection_name = collection["name"] if collection else f"Collection {collection_key}"
            items = reader.get_collection_items(collection_key, limit=limit, **_reader_kwargs())
        if not items:
            return f"No items found in collection: {collection_name} (Key: {collection_key})"

        # Format items as markdown
        output = [f"# Items in Collection: {collection_name}", ""]

        for i, item in enumerate(items, 1):
            output.extend(_format_item_summary(item, i))

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching collection items: {str(e)}")
        return f"Error fetching collection items: {str(e)}"


@mcp.tool(
    name="zotero_get_desktop_plugin_capabilities",
    description="Check whether the local Zotero desktop mutation bridge is available and what it supports."
)
def get_desktop_plugin_capabilities(
    verbose: bool = False,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "getDesktopPluginCapabilities"
    try:
        ctx.info("Checking Zotero desktop bridge capabilities")
        result = get_desktop_bridge_client().capabilities(verbose=verbose)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error checking Zotero desktop bridge capabilities: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_resolve_collection_path",
    description="Resolve a human-readable Zotero collection path such as Planning/Agents to a stable collection key."
)
def resolve_collection_path(
    collection_path: str,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "resolveCollectionPath"
    cleaned_path = _clean_optional_text(collection_path)
    if not cleaned_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "collection_path cannot be empty"),
        )

    try:
        ctx.info(f"Resolving collection path {cleaned_path}")
        result = get_desktop_bridge_client().resolve_collection_path(
            collection_path=cleaned_path
        )
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error resolving collection path: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_create_collection",
    description="Create a Zotero collection by name or full path through the local desktop mutation bridge."
)
def create_collection(
    name: str | None = None,
    path: str | None = None,
    parent_collection_key: str | None = None,
    parent_collection_path: str | None = None,
    create_missing_parents: bool = False,
    if_exists: Literal["error", "return_existing"] = "error",
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "createCollection"
    cleaned_name = _clean_optional_text(name)
    cleaned_path = _clean_optional_text(path)
    if not cleaned_name and not cleaned_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "Provide either name or path"),
        )

    payload = {
        "name": cleaned_name,
        "path": cleaned_path,
        "parentCollectionKey": _clean_optional_text(parent_collection_key),
        "parentCollectionPath": _clean_optional_text(parent_collection_path),
        "createMissingParents": create_missing_parents,
        "ifExists": if_exists,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Creating Zotero collection via desktop bridge")
        result = get_desktop_bridge_client().create_collection(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error creating collection: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_delete_collection",
    description="Delete a Zotero collection container without deleting the underlying library items."
)
def delete_collection(
    collection_key: str | None = None,
    collection_path: str | None = None,
    recursive: bool = False,
    force: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "deleteCollection"
    cleaned_key = _clean_optional_text(collection_key)
    cleaned_path = _clean_optional_text(collection_path)
    if not cleaned_key and not cleaned_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either collection_key or collection_path",
            ),
        )

    payload = {
        "collectionKey": cleaned_key,
        "collectionPath": cleaned_path,
        "recursive": recursive,
        "force": force,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Deleting Zotero collection via desktop bridge")
        result = get_desktop_bridge_client().delete_collection(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error deleting collection: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_batch_create_collections",
    description="Create multiple Zotero collections in one request through the local desktop mutation bridge."
)
def batch_create_collections(
    collection_requests: list[dict[str, Any]],
    continue_on_error: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "batchCreateCollections"
    if not collection_requests:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "collection_requests cannot be empty"),
        )

    def _normalize_collection_request(request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise ValueError("Each collection request must be an object")

        key_map = {
            "parent_collection_key": "parentCollectionKey",
            "parent_collection_path": "parentCollectionPath",
            "create_missing_parents": "createMissingParents",
            "if_exists": "ifExists",
            "dry_run": "dryRun",
            "idempotency_key": "idempotencyKey",
        }
        normalized: dict[str, Any] = {}
        for key, value in request.items():
            normalized[key_map.get(key, key)] = value
        return normalized

    try:
        normalized_requests = [
            _normalize_collection_request(request) for request in collection_requests
        ]
    except ValueError as validation_error:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", str(validation_error)),
        )

    payload = {
        "requests": normalized_requests,
        "continueOnError": continue_on_error,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Batch creating Zotero collections via desktop bridge")
        result = get_desktop_bridge_client().batch_create_collections(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error batch creating collections: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_batch_delete_collections",
    description="Delete multiple Zotero collections in one request through the local desktop mutation bridge."
)
def batch_delete_collections(
    targets: list[dict[str, Any]],
    continue_on_error: bool = True,
    recursive: bool = False,
    force: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "batchDeleteCollections"
    if not targets:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "targets cannot be empty"),
        )

    payload = {
        "targets": targets,
        "continueOnError": continue_on_error,
        "recursive": recursive,
        "force": force,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Batch deleting Zotero collections via desktop bridge")
        result = get_desktop_bridge_client().batch_delete_collections(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error batch deleting collections: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_import_pdf_to_collection",
    description="Import a local PDF into Zotero and place it into a target collection through the desktop mutation bridge. This is the preferred import path whenever you already have a PDF."
)
def import_pdf_to_collection(
    file_path: str,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    title: str | None = None,
    authors: list[str] | None = None,
    year: int | str | None = None,
    doi: str | None = None,
    tags: list[str] | None = None,
    link_mode: Literal["imported_file", "linked_file"] | None = None,
    on_duplicate: Literal[
        "error",
        "attach_to_existing",
        "add_existing_to_collection",
        "skip",
    ] | None = None,
    create_target_if_missing: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "importPdfToCollection"
    cleaned_file_path = _clean_optional_text(file_path)
    if not cleaned_file_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "file_path cannot be empty"),
        )

    if not _clean_optional_text(target_collection_key) and not _clean_optional_text(target_collection_path):
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    payload = {
        "filePath": cleaned_file_path,
        "targetCollectionKey": _clean_optional_text(target_collection_key),
        "targetCollectionPath": _clean_optional_text(target_collection_path),
        "title": _clean_optional_text(title),
        "authors": authors or [],
        "year": str(year) if year is not None else None,
        "doi": _clean_optional_text(doi),
        "tags": tags or [],
        "linkMode": _clean_optional_text(link_mode),
        "onDuplicate": _clean_optional_text(on_duplicate),
        "createTargetIfMissing": create_target_if_missing,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    staged_pdf: StagedPDF | None = None
    client = get_desktop_bridge_client()

    try:
        staged_pdf = _stage_pdf_for_bridge_import(client, cleaned_file_path)
        payload["filePath"] = str(staged_pdf.staged_path)
        ctx.info(
            f"Importing staged PDF {payload['filePath']} via desktop bridge "
            f"(source: {cleaned_file_path})"
        )
        result = client.import_pdf_to_collection(**payload)
        result["stagedFilePath"] = str(staged_pdf.staged_path)
        result["sourceFilePath"] = cleaned_file_path
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error importing PDF to collection: {str(e)}")
        return _bridge_failure(operation, e)
    finally:
        if dry_run and staged_pdf:
            _cleanup_staged_previews([staged_pdf])


@mcp.tool(
    name="zotero_import_identifier_to_collection",
    description="Import metadata into Zotero from a DOI/ISBN/PMID/arXiv-style identifier through the desktop mutation bridge. This is a metadata fallback when no local PDF is available; prefer zotero_import_pdf_to_collection whenever you already have a PDF."
)
def import_identifier_to_collection(
    identifier: str,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    tags: list[str] | None = None,
    save_attachments: bool = False,
    create_target_if_missing: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "importIdentifierToCollection"
    cleaned_identifier = _clean_optional_text(identifier)
    if not cleaned_identifier:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "identifier cannot be empty"),
        )

    if not _clean_optional_text(target_collection_key) and not _clean_optional_text(target_collection_path):
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    payload = {
        "identifier": cleaned_identifier,
        "targetCollectionKey": _clean_optional_text(target_collection_key),
        "targetCollectionPath": _clean_optional_text(target_collection_path),
        "tags": tags or [],
        "saveAttachments": save_attachments,
        "createTargetIfMissing": create_target_if_missing,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info(f"Importing identifier {cleaned_identifier} via desktop bridge")
        result = get_desktop_bridge_client().import_identifier_to_collection(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error importing identifier: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_import_bibtex_to_collection",
    description="Import metadata into Zotero from BibTeX or BibLaTeX text through the desktop mutation bridge. This is a metadata fallback when no local PDF is available; prefer zotero_import_pdf_to_collection whenever you already have a PDF."
)
def import_bibtex_to_collection(
    bibtex: str,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    tags: list[str] | None = None,
    save_attachments: bool = False,
    create_target_if_missing: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "importBibtexToCollection"
    cleaned_bibtex = _clean_optional_text(bibtex)
    if not cleaned_bibtex:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "bibtex cannot be empty"),
        )

    if not _clean_optional_text(target_collection_key) and not _clean_optional_text(target_collection_path):
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    payload = {
        "bibtex": cleaned_bibtex,
        "targetCollectionKey": _clean_optional_text(target_collection_key),
        "targetCollectionPath": _clean_optional_text(target_collection_path),
        "tags": tags or [],
        "saveAttachments": save_attachments,
        "createTargetIfMissing": create_target_if_missing,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Importing BibTeX metadata via desktop bridge")
        result = get_desktop_bridge_client().import_bibtex_to_collection(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error importing BibTeX metadata: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_create_collection_note",
    description="Create a standalone Zotero note and place it into a target collection through the desktop mutation bridge."
)
def create_collection_note(
    note_html: str,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    note_title: str | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "createCollectionNote"
    cleaned_note_html = _clean_optional_text(note_html)
    cleaned_collection_key = _clean_optional_text(target_collection_key)
    cleaned_collection_path = _clean_optional_text(target_collection_path)
    if not cleaned_note_html:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "note_html cannot be empty"),
        )

    if not cleaned_collection_key and not cleaned_collection_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    payload = {
        "noteHtml": cleaned_note_html,
        "noteTitle": _clean_optional_text(note_title),
        "targetCollectionKey": cleaned_collection_key,
        "targetCollectionPath": cleaned_collection_path,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Creating standalone Zotero note via desktop bridge")
        result = get_desktop_bridge_client().create_collection_note(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error creating collection note: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_create_child_note",
    description="Create a child note under an existing Zotero item through the desktop mutation bridge."
)
def create_child_note(
    parent_item_key: str,
    note_html: str,
    note_title: str | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "createChildNote"
    cleaned_parent_item_key = _clean_optional_text(parent_item_key)
    cleaned_note_html = _clean_optional_text(note_html)
    if not cleaned_parent_item_key:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "parent_item_key cannot be empty"),
        )
    if not cleaned_note_html:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "note_html cannot be empty"),
        )

    payload = {
        "parentItemKey": cleaned_parent_item_key,
        "noteHtml": cleaned_note_html,
        "noteTitle": _clean_optional_text(note_title),
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info(f"Creating child note under item {cleaned_parent_item_key} via desktop bridge")
        result = get_desktop_bridge_client().create_child_note(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error creating child note: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_batch_import_pdfs_to_collection",
    description="Batch import local PDFs into a Zotero collection through the desktop mutation bridge. This is the preferred bulk import path whenever local PDFs are available."
)
def batch_import_pdfs_to_collection(
    file_paths: list[str] | None = None,
    directory_path: str | None = None,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    recursive_scan: bool = False,
    continue_on_error: bool = True,
    link_mode: Literal["imported_file", "linked_file"] | None = None,
    on_duplicate: Literal[
        "error",
        "attach_to_existing",
        "add_existing_to_collection",
        "skip",
    ] | None = None,
    create_target_if_missing: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "batchImportPdfsToCollection"
    cleaned_file_paths = [path for path in (file_paths or []) if _clean_optional_text(path)]
    cleaned_directory = _clean_optional_text(directory_path)
    if not cleaned_file_paths and not cleaned_directory:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide file_paths or directory_path",
            ),
        )

    if not _clean_optional_text(target_collection_key) and not _clean_optional_text(target_collection_path):
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    payload = {
        "filePaths": cleaned_file_paths,
        "directoryPath": cleaned_directory,
        "targetCollectionKey": _clean_optional_text(target_collection_key),
        "targetCollectionPath": _clean_optional_text(target_collection_path),
        "recursiveScan": recursive_scan,
        "continueOnError": continue_on_error,
        "linkMode": _clean_optional_text(link_mode),
        "onDuplicate": _clean_optional_text(on_duplicate),
        "createTargetIfMissing": create_target_if_missing,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    staged_pdfs: list[StagedPDF] = []
    client = get_desktop_bridge_client()

    try:
        source_paths = list(cleaned_file_paths)
        if cleaned_directory:
            try:
                source_paths.extend(collect_pdf_paths(cleaned_directory, recursive=recursive_scan))
            except ImportBufferError as error:
                raise DesktopBridgeError(
                    "BUFFER_STAGE_FAILED",
                    str(error),
                    status_code=400,
                ) from error

        if not source_paths:
            raise DesktopBridgeError(
                "VALIDATION_ERROR",
                "No PDF files were found to stage for import",
                status_code=400,
            )

        staged_pdfs = [_stage_pdf_for_bridge_import(client, path) for path in source_paths]
        payload["filePaths"] = [str(staged_pdf.staged_path) for staged_pdf in staged_pdfs]
        payload["directoryPath"] = None

        ctx.info(
            f"Batch importing {len(staged_pdfs)} staged PDFs via desktop bridge"
        )
        result = client.batch_import_pdfs_to_collection(**payload)
        result["stagedFilePaths"] = [str(staged_pdf.staged_path) for staged_pdf in staged_pdfs]
        result["sourceFilePaths"] = source_paths
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error batch importing PDFs: {str(e)}")
        return _bridge_failure(operation, e)
    finally:
        if dry_run and staged_pdfs:
            _cleanup_staged_previews(staged_pdfs)


@mcp.tool(
    name="zotero_move_items_between_collections",
    description="Move one or more Zotero items from a source collection to a target collection through the desktop mutation bridge. This changes collection membership only and does not move metadata or attachment files in Zotero storage."
)
def move_items_between_collections(
    source_collection_key: str | None = None,
    source_collection_path: str | None = None,
    target_collection_key: str | None = None,
    target_collection_path: str | None = None,
    item_keys: list[str] | None = None,
    move_all: bool = False,
    continue_on_error: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context,
) -> dict[str, Any]:
    operation = "moveItemsBetweenCollections"
    cleaned_source_collection_key = _clean_optional_text(source_collection_key)
    cleaned_source_collection_path = _clean_optional_text(source_collection_path)
    cleaned_target_collection_key = _clean_optional_text(target_collection_key)
    cleaned_target_collection_path = _clean_optional_text(target_collection_path)
    cleaned_item_keys = [
        cleaned
        for cleaned in (_clean_optional_text(item_key) for item_key in (item_keys or []))
        if cleaned
    ]

    if not cleaned_source_collection_key and not cleaned_source_collection_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either source_collection_key or source_collection_path",
            ),
        )

    if not cleaned_target_collection_key and not cleaned_target_collection_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either target_collection_key or target_collection_path",
            ),
        )

    if not move_all and not cleaned_item_keys:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide item_keys or set move_all=true",
            ),
        )

    payload = {
        "sourceCollectionKey": cleaned_source_collection_key,
        "sourceCollectionPath": cleaned_source_collection_path,
        "targetCollectionKey": cleaned_target_collection_key,
        "targetCollectionPath": cleaned_target_collection_path,
        "itemKeys": cleaned_item_keys,
        "moveAll": move_all,
        "continueOnError": continue_on_error,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info("Moving items between Zotero collections via desktop bridge")
        result = get_desktop_bridge_client().move_items_between_collections(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error moving items between collections: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_remove_item_from_collection",
    description="Remove a Zotero item from a single collection without deleting the library item."
)
def remove_item_from_collection(
    item_key: str,
    collection_key: str | None = None,
    collection_path: str | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context
) -> dict[str, Any]:
    operation = "removeItemFromCollection"
    cleaned_item_key = _clean_optional_text(item_key)
    cleaned_collection_key = _clean_optional_text(collection_key)
    cleaned_collection_path = _clean_optional_text(collection_path)
    if not cleaned_item_key:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "item_key cannot be empty"),
        )

    if not cleaned_collection_key and not cleaned_collection_path:
        return _bridge_failure(
            operation,
            DesktopBridgeError(
                "VALIDATION_ERROR",
                "Provide either collection_key or collection_path",
            ),
        )

    payload = {
        "itemKey": cleaned_item_key,
        "collectionKey": cleaned_collection_key,
        "collectionPath": cleaned_collection_path,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info(f"Removing item {cleaned_item_key} from collection via desktop bridge")
        result = get_desktop_bridge_client().remove_item_from_collection(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error removing item from collection: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_delete_item",
    description="Safely move a Zotero item to the trash through the desktop bridge."
)
def delete_item(
    item_key: str,
    force: bool = False,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    *,
    ctx: Context,
) -> dict[str, Any]:
    operation = "deleteItem"
    cleaned_item_key = _clean_optional_text(item_key)
    if not cleaned_item_key:
        return _bridge_failure(
            operation,
            DesktopBridgeError("VALIDATION_ERROR", "item_key cannot be empty"),
        )

    payload = {
        "itemKey": cleaned_item_key,
        "force": force,
        "dryRun": dry_run,
        "idempotencyKey": _clean_optional_text(idempotency_key),
    }

    try:
        ctx.info(f"Deleting item {cleaned_item_key} via desktop bridge")
        result = get_desktop_bridge_client().delete_item(**payload)
        return _bridge_success(operation, result)
    except Exception as e:
        ctx.error(f"Error deleting item: {str(e)}")
        return _bridge_failure(operation, e)


@mcp.tool(
    name="zotero_get_item_children",
    description="Get all child items (attachments, notes) for a specific Zotero item."
)
def get_item_children(
    item_key: str,
    *,
    ctx: Context
) -> str:
    """
    Get all child items (attachments, notes) for a specific Zotero item.

    Args:
        item_key: Zotero item key/ID
        ctx: MCP context

    Returns:
        Markdown-formatted list of child items
    """
    try:
        ctx.info(f"Fetching children for item {item_key}")
        with LocalZoteroReader() as reader:
            parent = reader.get_item_details_by_key(item_key, **_reader_kwargs())
            parent_title = parent["data"].get("title", "Untitled Item") if parent else f"Item {item_key}"
            children = reader.get_item_children(item_key, **_reader_kwargs())
        if not children:
            return f"No child items found for: {parent_title} (Key: {item_key})"

        # Format children as markdown
        output = [f"# Child Items for: {parent_title}", ""]

        # Group children by type
        attachments = []
        notes = []
        others = []

        for child in children:
            data = child.get("data", {})
            item_type = data.get("itemType", "unknown")

            if item_type == "attachment":
                attachments.append(child)
            elif item_type == "note":
                notes.append(child)
            else:
                others.append(child)

        # Format attachments
        if attachments:
            output.append("## Attachments")
            for i, att in enumerate(attachments, 1):
                data = att.get("data", {})
                title = data.get("title", "Untitled")
                key = att.get("key", "")
                content_type = data.get("contentType", "Unknown")
                filename = data.get("filename", "")

                output.append(f"{i}. **{title}**")
                output.append(f"   - Key: {key}")
                output.append(f"   - Type: {content_type}")
                if filename:
                    output.append(f"   - Filename: {filename}")
                output.append("")

        # Format notes
        if notes:
            output.append("## Notes")
            for i, note in enumerate(notes, 1):
                data = note.get("data", {})
                title = data.get("title", "Untitled Note")
                key = note.get("key", "")
                note_text = data.get("note", "")

                # Clean up HTML in notes
                note_text = note_text.replace("<p>", "").replace("</p>", "\n\n")
                note_text = note_text.replace("<br/>", "\n").replace("<br>", "\n")

                # Limit note length for display
                if len(note_text) > 500:
                    note_text = note_text[:500] + "...\n\n(Note truncated)"

                output.append(f"{i}. **{title}**")
                output.append(f"   - Key: {key}")
                output.append(f"   - Content:\n```\n{note_text}\n```")
                output.append("")

        # Format other item types
        if others:
            output.append("## Other Items")
            for i, other in enumerate(others, 1):
                data = other.get("data", {})
                title = data.get("title", "Untitled")
                key = other.get("key", "")
                item_type = data.get("itemType", "unknown")

                output.append(f"{i}. **{title}**")
                output.append(f"   - Key: {key}")
                output.append(f"   - Type: {item_type}")
                output.append("")

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching item children: {str(e)}")
        return f"Error fetching item children: {str(e)}"


@mcp.tool(
    name="zotero_get_tags",
    description="Get all tags used in your Zotero library."
)
def get_tags(
    limit: int | str | None = None,
    *,
    ctx: Context
) -> str:
    """
    Get all tags used in your Zotero library.

    Args:
        limit: Maximum number of tags to return
        ctx: MCP context

    Returns:
        Markdown-formatted list of tags
    """
    try:
        ctx.info("Fetching tags")
        limit = _normalize_limit(limit, default=200, maximum=1000) if limit is not None else None

        with LocalZoteroReader() as reader:
            tags = reader.get_all_tags(limit=limit, **_reader_kwargs())
        if not tags:
            return "No tags found in your Zotero library."

        # Format tags as markdown
        output = ["# Zotero Tags", ""]

        # Sort tags alphabetically
        sorted_tags = sorted(tags)

        # Group tags alphabetically
        current_letter = None
        for tag in sorted_tags:
            first_letter = tag[0].upper() if tag else "#"

            if first_letter != current_letter:
                current_letter = first_letter
                output.append(f"## {current_letter}")

            output.append(f"- `{tag}`")

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching tags: {str(e)}")
        return f"Error fetching tags: {str(e)}"


@mcp.tool(
    name="zotero_list_libraries",
    description="List all accessible Zotero libraries (user library, group libraries, and RSS feeds). Use this to discover available libraries before switching with zotero_switch_library.",
)
def list_libraries(*, ctx: Context) -> str:
    """
    List all accessible Zotero libraries.

    In local mode, reads directly from the SQLite database.
    In web mode, queries groups via the Zotero API.

    Returns:
        Markdown-formatted list of libraries with item counts.
    """
    try:
        ctx.info("Listing accessible libraries")
        local = os.getenv("ZOTERO_LOCAL", "").lower() in ["true", "yes", "1"]
        override = get_active_library()

        output = ["# Zotero Libraries", ""]

        # Show active library context
        if override:
            output.append(
                f"> **Active library:** ID={override['library_id']}, "
                f"type={override['library_type']}"
            )
            output.append("")

        from zotero_mcp.local_db import LocalZoteroReader

        reader = LocalZoteroReader()
        try:
            libraries = reader.get_libraries()

            # User library
            user_libs = [l for l in libraries if l["type"] == "user"]
            if user_libs:
                output.append("## User Library")
                for lib in user_libs:
                    output.append(
                        f"- **My Library** — {lib['itemCount']} items "
                        f"(libraryID={lib['libraryID']})"
                    )
                output.append("")

            # Group libraries
            group_libs = [l for l in libraries if l["type"] == "group"]
            if group_libs:
                output.append("## Group Libraries")
                for lib in group_libs:
                    desc = f" — {lib['groupDescription']}" if lib.get("groupDescription") else ""
                    output.append(
                        f"- **{lib['groupName']}** — {lib['itemCount']} items "
                        f"(groupID={lib['groupID']}){desc}"
                    )
                output.append("")

            # Feeds
            feed_libs = [l for l in libraries if l["type"] == "feed"]
            if feed_libs:
                output.append("## RSS Feeds")
                for lib in feed_libs:
                    output.append(
                        f"- **{lib['feedName']}** — {lib['itemCount']} items "
                        f"(libraryID={lib['libraryID']})"
                    )
                output.append("")
        finally:
            reader.close()

        output.append("")
        output.append(
            "Use `zotero_switch_library` to switch to a different library."
        )

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error listing libraries: {str(e)}")
        return f"Error listing libraries: {str(e)}"


@mcp.tool(
    name="zotero_switch_library",
    description="Switch the active Zotero library context. All subsequent tool calls will operate on the selected library. Use zotero_list_libraries first to see available options. Pass library_type='default' to reset to the original environment variable configuration.",
)
def switch_library(
    library_id: str,
    library_type: str = "user",
    *,
    ctx: Context,
) -> str:
    """
    Switch the active library for all subsequent MCP tool calls.

    Args:
        library_id: The library/group ID to switch to.
            For user library: "0" (local mode) or your user ID (web mode).
            For group libraries: the groupID (e.g. "6069773").
        library_type: "user", "group", or "default" to reset to env var defaults.
        ctx: MCP context

    Returns:
        Confirmation message with active library details.
    """
    try:
        if library_type == "default":
            clear_active_library()
            ctx.info("Reset to default library configuration")
            return (
                "Switched back to default library configuration "
                f"(ZOTERO_LIBRARY_ID={os.getenv('ZOTERO_LIBRARY_ID', '0')}, "
                f"ZOTERO_LIBRARY_TYPE={os.getenv('ZOTERO_LIBRARY_TYPE', 'user')})"
            )

        error = validate_library_switch(library_id, library_type)
        if error:
            return error

        set_active_library(library_id, library_type)
        ctx.info(f"Switched to library {library_id} (type={library_type})")
        return (
            f"Successfully switched to library **{library_id}** "
            f"(type={library_type}). Local read tools now operate on this library."
        )

    except Exception as e:
        ctx.error(f"Error switching library: {str(e)}")
        return f"Error switching library: {str(e)}"


def validate_library_switch(library_id: str, library_type: str) -> str | None:
    """Validate a library switch request before applying it.

    Returns an error message string if the switch should be rejected,
    or None if the switch is valid and should proceed.
    """
    if library_type not in ("user", "group", "feed"):
        return f"Invalid library_type '{library_type}'. Must be 'user', 'group', or 'feed'."

    # In local mode, verify the library actually exists in the database
    local = os.getenv("ZOTERO_LOCAL", "").lower() in ["true", "yes", "1"]
    if local:
        try:
            from zotero_mcp.local_db import LocalZoteroReader

            reader = LocalZoteroReader()
            try:
                libraries = reader.get_libraries()
                if library_type == "user":
                    valid_ids = {
                        str(l["libraryID"])
                        for l in libraries
                        if l["type"] == "user"
                    } | {"0"}
                    if library_id not in valid_ids:
                        return (
                            f"User library '{library_id}' not found. "
                            f"Available user libraries: {', '.join(sorted(valid_ids))}"
                        )
                elif library_type == "group":
                    valid_ids = {str(l["groupID"]) for l in libraries if l["type"] == "group"}
                    if library_id not in valid_ids:
                        return (
                            f"Group '{library_id}' not found. "
                            f"Available groups: {', '.join(sorted(valid_ids))}"
                        )
                elif library_type == "feed":
                    valid_ids = {str(l["libraryID"]) for l in libraries if l["type"] == "feed"}
                    if library_id not in valid_ids:
                        return (
                            f"Feed with libraryID '{library_id}' not found. "
                            f"Available feeds: {', '.join(sorted(valid_ids))}"
                        )
            finally:
                reader.close()
        except Exception:
            pass  # If DB unavailable, skip validation — the test call will catch it

    return None


@mcp.tool(
    name="zotero_list_feeds",
    description="List all RSS feed subscriptions in your local Zotero installation. Shows feed names, URLs, item counts, and last check times. Local mode only.",
)
def list_feeds(*, ctx: Context) -> str:
    """
    List all RSS feed subscriptions from the local Zotero database.

    Returns:
        Markdown-formatted list of RSS feeds.
    """
    try:
        local = os.getenv("ZOTERO_LOCAL", "").lower() in ["true", "yes", "1"]
        if not local:
            return "RSS feeds are only accessible in local mode (ZOTERO_LOCAL=true)."

        ctx.info("Listing RSS feeds")
        from zotero_mcp.local_db import LocalZoteroReader

        reader = LocalZoteroReader()
        try:
            feeds = reader.get_feeds()
            if not feeds:
                return "No RSS feeds found in your Zotero installation."

            output = ["# RSS Feeds", ""]
            for feed in feeds:
                last_check = feed["lastCheck"] or "never"
                error = f" (error: {feed['lastCheckError']})" if feed.get("lastCheckError") else ""
                output.append(f"### {feed['name']}")
                output.append(f"- **URL:** {feed['url']}")
                output.append(f"- **Items:** {feed['itemCount']}")
                output.append(f"- **Last checked:** {last_check}{error}")
                output.append(f"- **Library ID:** {feed['libraryID']}")
                output.append("")

            output.append(
                "Use `zotero_get_feed_items` with a feed's library ID to view its items."
            )
            return "\n".join(output)
        finally:
            reader.close()

    except Exception as e:
        ctx.error(f"Error listing feeds: {str(e)}")
        return f"Error listing feeds: {str(e)}"


@mcp.tool(
    name="zotero_get_feed_items",
    description="Get items from a specific RSS feed by its library ID. Use zotero_list_feeds first to find feed library IDs. Local mode only.",
)
def get_feed_items(
    library_id: int,
    limit: int = 20,
    *,
    ctx: Context,
) -> str:
    """
    Retrieve items from a specific RSS feed.

    Args:
        library_id: The libraryID of the feed (from zotero_list_feeds).
        limit: Maximum number of items to return.
        ctx: MCP context

    Returns:
        Markdown-formatted list of feed items.
    """
    try:
        local = os.getenv("ZOTERO_LOCAL", "").lower() in ["true", "yes", "1"]
        if not local:
            return "RSS feed items are only accessible in local mode (ZOTERO_LOCAL=true)."

        ctx.info(f"Fetching items from feed (libraryID={library_id})")
        from zotero_mcp.local_db import LocalZoteroReader

        reader = LocalZoteroReader()
        try:
            # Verify this is actually a feed
            feeds = reader.get_feeds()
            feed_info = next((f for f in feeds if f["libraryID"] == library_id), None)
            if not feed_info:
                valid_ids = [str(f["libraryID"]) for f in feeds]
                return (
                    f"No feed found with libraryID={library_id}. "
                    f"Valid feed IDs: {', '.join(valid_ids)}"
                )

            items = reader.get_feed_items(library_id, limit=limit)
            if not items:
                return f"No items found in feed '{feed_info['name']}'."

            output = [f"# Feed: {feed_info['name']}", f"**URL:** {feed_info['url']}", ""]

            for item in items:
                read_status = "Read" if item.get("readTime") else "Unread"
                title = item.get("title") or "Untitled"
                output.append(f"### {title}")
                output.append(f"- **Status:** {read_status}")
                if item.get("creators"):
                    output.append(f"- **Authors:** {item['creators']}")
                if item.get("url"):
                    output.append(f"- **URL:** {item['url']}")
                output.append(f"- **Added:** {item.get('dateAdded', 'unknown')}")
                if item.get("abstract"):
                    abstract = clean_html(item["abstract"])
                    if len(abstract) > 200:
                        abstract = abstract[:200] + "..."
                    output.append(f"- **Abstract:** {abstract}")
                output.append("")

            return "\n".join(output)
        finally:
            reader.close()

    except Exception as e:
        ctx.error(f"Error fetching feed items: {str(e)}")
        return f"Error fetching feed items: {str(e)}"


@mcp.tool(
    name="zotero_get_recent",
    description="Get recently added items to your Zotero library."
)
def get_recent(
    limit: int | str = 10,
    *,
    ctx: Context
) -> str:
    """
    Get recently added items to your Zotero library.

    Args:
        limit: Number of items to return
        ctx: MCP context

    Returns:
        Markdown-formatted list of recent items
    """
    try:
        ctx.info(f"Fetching {limit} recent items")
        limit = _normalize_limit(limit, default=10, maximum=100)

        with LocalZoteroReader() as reader:
            items = reader.get_recent_items(limit=limit, **_reader_kwargs())
        if not items:
            return "No items found in your Zotero library."

        # Format items as markdown
        output = [f"# {limit} Most Recently Added Items", ""]

        for i, item in enumerate(items, 1):
            data = item.get("data", {})
            date_added = data.get("dateAdded", "Unknown")
            output.append(f"## {i}. {data.get('title', 'Untitled')}")
            output.append(f"**Type:** {data.get('itemType', 'unknown')}")
            output.append(f"**Item Key:** {item.get('key', '')}")
            output.append(f"**Date:** {data.get('date', 'No date')}")
            output.append(f"**Added:** {date_added}")
            output.append(f"**Authors:** {format_creators(data.get('creators', []))}")

            output.append("")  # Empty line between items

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching recent items: {str(e)}")
        return f"Error fetching recent items: {str(e)}"


@mcp.tool(
    name="zotero_batch_update_tags",
    description="Batch update tags across multiple items matching a search query."
)
def batch_update_tags(
    query: str,
    add_tags: list[str] | str | None = None,
    remove_tags: list[str] | str | None = None,
    limit: int | str = 50,
    dry_run: bool = False,
    *,
    ctx: Context
) -> str:
    """
    Batch update tags across multiple items matching a search query.

    Args:
        query: Search query to find items to update
        add_tags: List of tags to add to matched items (can be list or JSON string)
        remove_tags: List of tags to remove from matched items (can be list or JSON string)
        limit: Maximum number of items to process
        ctx: MCP context

    Returns:
        Summary of the batch update
    """
    try:
        if not query:
            return "Error: Search query cannot be empty"

        if not add_tags and not remove_tags:
            return "Error: You must specify either tags to add or tags to remove"

        def _normalize_tag_list(
            raw_value: list[str] | str | None, field_name: str
        ) -> list[str]:
            if raw_value is None:
                return []

            parsed_value = raw_value
            if isinstance(parsed_value, str):
                stripped_value = parsed_value.strip()
                if not stripped_value:
                    return []
                try:
                    parsed_value = json.loads(stripped_value)
                    ctx.info(f"Parsed {field_name} from JSON string: {parsed_value}")
                except json.JSONDecodeError:
                    if stripped_value[0] in "[{" or stripped_value[-1] in "]}":
                        raise ValueError(
                            f"{field_name} appears to be malformed JSON: {raw_value}"
                        )
                    return [stripped_value]

            if isinstance(parsed_value, str):
                parsed_value = [parsed_value]

            if not isinstance(parsed_value, list):
                raise ValueError(
                    f"{field_name} must be a JSON array or a list of strings"
                )

            normalized = []
            for tag_value in parsed_value:
                if not isinstance(tag_value, str):
                    raise ValueError(f"{field_name} entries must all be strings")
                stripped = tag_value.strip()
                if stripped:
                    normalized.append(stripped)
            return normalized

        try:
            add_tags = _normalize_tag_list(add_tags, "add_tags")
            remove_tags = _normalize_tag_list(remove_tags, "remove_tags")
        except ValueError as validation_error:
            return f"Error: {validation_error}"

        if not add_tags and not remove_tags:
            return "Error: After parsing, no valid tags were provided to add or remove"

        ctx.info(f"Batch updating tags for items matching '{query}'")
        limit = _normalize_limit(limit, default=50, maximum=500)

        with LocalZoteroReader() as reader:
            items = _search_local_items(
                reader,
                query=query,
                qmode="everything",
                limit=limit,
            )

        if not items:
            return f"No items found matching query: '{query}'"

        result = get_desktop_bridge_client().batch_update_tags(
            itemKeys=[item["key"] for item in items],
            addTags=add_tags,
            removeTags=remove_tags,
            dryRun=dry_run,
            continueOnError=True,
        )

        # Format the response
        response = ["# Batch Tag Update Results", ""]
        response.append(f"Query: '{query}'")
        response.append(f"Items matched: {len(items)}")
        response.append(f"Items updated: {result.get('updated', 0)}")
        response.append(f"Items skipped: {result.get('skipped', 0)}")
        response.append(f"Items failed: {result.get('failed', 0)}")
        if dry_run:
            response.append("Mode: dry_run")
        if add_tags:
            response.append(f"Tags to add: {', '.join(f'`{tag}`' for tag in add_tags)}")
        if remove_tags:
            response.append(f"Tags to remove: {', '.join(f'`{tag}`' for tag in remove_tags)}")

        return "\n".join(response)

    except Exception as e:
        ctx.error(f"Error in batch tag update: {str(e)}")
        return f"Error in batch tag update: {str(e)}"


@mcp.tool(
    name="zotero_advanced_search",
    description="Perform an advanced search with multiple criteria."
)
def advanced_search(
    conditions: list[dict[str, str]],
    join_mode: Literal["all", "any"] = "all",
    sort_by: str | None = None,
    sort_direction: Literal["asc", "desc"] = "asc",
    limit: int | str = 50,
    *,
    ctx: Context
) -> str:
    """
    Perform an advanced search with multiple criteria.

    Args:
        conditions: List of search condition dictionaries, each containing:
                   - field: The field to search (title, creator, date, tag, etc.)
                   - operation: The operation to perform (is, isNot, contains, etc.)
                   - value: The value to search for
        join_mode: Whether all conditions must match ("all") or any condition can match ("any")
        sort_by: Field to sort by (dateAdded, dateModified, title, creator, etc.)
        sort_direction: Direction to sort (asc or desc)
        limit: Maximum number of results to return
        ctx: MCP context

    Returns:
        Markdown-formatted search results
    """
    try:
        if isinstance(conditions, str):
            try:
                conditions = json.loads(conditions)
            except json.JSONDecodeError as parse_error:
                return (
                    "Error: conditions must be valid JSON when provided as a string "
                    f"({parse_error})"
                )

        if not isinstance(conditions, list) or not conditions:
            return "Error: No search conditions provided"

        if join_mode not in {"all", "any"}:
            return "Error: join_mode must be either 'all' or 'any'"

        if isinstance(limit, str):
            limit = int(limit)
        if limit <= 0:
            return "Error: limit must be greater than 0"
        if limit > 500:
            limit = 500

        ctx.info(f"Performing advanced search with {len(conditions)} conditions")

        valid_operations = {
            "is",
            "isNot",
            "contains",
            "doesNotContain",
            "beginsWith",
            "endsWith",
            "isGreaterThan",
            "isLessThan",
            "isBefore",
            "isAfter",
        }

        parsed_conditions: list[dict[str, str]] = []
        for i, condition in enumerate(conditions, 1):
            if not isinstance(condition, dict):
                return f"Error: Condition {i} must be an object"
            if "operation" not in condition and "operator" in condition:
                condition = dict(condition)
                condition["operation"] = condition["operator"]
            if "field" not in condition or "operation" not in condition or "value" not in condition:
                return (
                    f"Error: Condition {i} is missing required fields "
                    "(field, operation, value)"
                )

            field = str(condition["field"]).strip()
            operation = str(condition["operation"]).strip()
            value = str(condition["value"]).strip()

            if operation not in valid_operations:
                return (
                    f"Error: Unsupported operation '{operation}' in condition {i}. "
                    f"Supported: {', '.join(sorted(valid_operations))}"
                )
            if not field:
                return f"Error: Condition {i} has an empty field"

            parsed_conditions.append(
                {"field": field, "operation": operation, "value": value}
            )

        def _extract_values(data: dict[str, object], field: str) -> list[str]:
            field_lower = field.lower()

            if field_lower in {"author", "authors", "creator", "creators"}:
                creators = data.get("creators", []) or []
                values: list[str] = []
                for creator in creators:
                    if not isinstance(creator, dict):
                        continue
                    if creator.get("firstName") or creator.get("lastName"):
                        full_name = " ".join(
                            [
                                str(creator.get("firstName", "")).strip(),
                                str(creator.get("lastName", "")).strip(),
                            ]
                        ).strip()
                        if full_name:
                            values.append(full_name)
                    if creator.get("name"):
                        values.append(str(creator.get("name", "")).strip())
                return values

            if field_lower in {"tag", "tags"}:
                tags = data.get("tags", []) or []
                values = []
                for tag in tags:
                    if isinstance(tag, dict) and tag.get("tag"):
                        values.append(str(tag.get("tag", "")).strip())
                return values

            if field_lower == "year":
                date_value = str(data.get("date", "")).strip()
                return [date_value[:4]] if len(date_value) >= 4 else []

            field_aliases = {
                "itemtype": "itemType",
                "dateadded": "dateAdded",
                "datemodified": "dateModified",
                "doi": "DOI",
            }
            source_field = field_aliases.get(field_lower, field)
            raw_value = data.get(source_field, "")
            if raw_value is None:
                return []
            return [str(raw_value).strip()]

        def _as_float(text: str) -> float | None:
            try:
                return float(text)
            except ValueError:
                return None

        def _compare(candidate: str, expected: str, operation: str) -> bool:
            left = candidate.lower()
            right = expected.lower()

            if operation == "is":
                return left == right
            if operation == "isNot":
                return left != right
            if operation == "contains":
                return right in left
            if operation == "doesNotContain":
                return right not in left
            if operation == "beginsWith":
                return left.startswith(right)
            if operation == "endsWith":
                return left.endswith(right)

            left_num = _as_float(left)
            right_num = _as_float(right)
            if (
                operation in {"isGreaterThan", "isLessThan", "isBefore", "isAfter"}
                and left_num is not None
                and right_num is not None
            ):
                if operation in {"isGreaterThan", "isAfter"}:
                    return left_num > right_num
                return left_num < right_num

            if operation in {"isGreaterThan", "isAfter"}:
                return left > right
            return left < right

        def _matches_condition(data: dict[str, object], condition: dict[str, str]) -> bool:
            values = _extract_values(data, condition["field"])
            if not values:
                return False

            operation = condition["operation"]
            target = condition["value"]
            comparisons = [_compare(value, target, operation) for value in values]

            if operation in {"isNot", "doesNotContain"}:
                return all(comparisons)
            return any(comparisons)

        # Execute advanced search by iterating items and filtering client-side.
        with LocalZoteroReader() as reader:
            candidate_items = reader.get_items(limit=None, **_reader_kwargs())

        results = []
        for item in candidate_items:
            data = item.get("data", {})
            checks = [_matches_condition(data, c) for c in parsed_conditions]
            matched = all(checks) if join_mode == "all" else any(checks)
            if matched:
                results.append(item)

        if sort_by:
            sort_field = sort_by.strip()
            reverse = sort_direction == "desc"

            def _sort_key(item: dict[str, object]) -> str:
                data = item.get("data", {}) if isinstance(item, dict) else {}
                if sort_field in {"creator", "author"}:
                    return format_creators(data.get("creators", []))
                return str(data.get(sort_field, "")).lower()

            results.sort(key=_sort_key, reverse=reverse)

        if not results:
            return "No items found matching the search criteria."

        results = results[:limit]

        output = ["# Advanced Search Results", ""]
        output.append(f"Found {len(results)} items matching the search criteria:")
        output.append("")
        output.append("## Search Criteria")
        output.append(f"Join mode: {join_mode.upper()}")
        for i, condition in enumerate(parsed_conditions, 1):
            output.append(
                f"{i}. {condition['field']} {condition['operation']} \"{condition['value']}\""
            )
        output.append("")
        output.append("## Results")

        for i, item in enumerate(results, 1):
            data = item.get("data", {})
            title = data.get("title", "Untitled")
            item_type = data.get("itemType", "unknown")
            date = data.get("date", "No date")
            key = item.get("key", "")

            creators = data.get("creators", [])
            creators_str = format_creators(creators)

            output.append(f"### {i}. {title}")
            output.append(f"**Type:** {item_type}")
            output.append(f"**Item Key:** {key}")
            output.append(f"**Date:** {date}")
            output.append(f"**Authors:** {creators_str}")

            if abstract := data.get("abstractNote"):
                abstract_snippet = abstract[:150] + "..." if len(abstract) > 150 else abstract
                output.append(f"**Abstract:** {abstract_snippet}")

            if tags := data.get("tags"):
                tag_list = [f"`{tag['tag']}`" for tag in tags]
                if tag_list:
                    output.append(f"**Tags:** {' '.join(tag_list)}")

            output.append("")

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error in advanced search: {str(e)}")
        return f"Error in advanced search: {str(e)}"


@mcp.tool(
    name="zotero_get_notes",
    description="Retrieve notes from your Zotero library, with options to filter by parent item."
)
def get_notes(
    item_key: str | None = None,
    limit: int | str | None = 20,
    truncate: bool = True,
    *,
    ctx: Context
) -> str:
    """
    Retrieve notes from your Zotero library.

    Args:
        item_key: Optional Zotero item key/ID to filter notes by parent item
        limit: Maximum number of notes to return
        truncate: Whether to truncate long notes for display
        ctx: MCP context

    Returns:
        Markdown-formatted list of notes
    """
    try:
        ctx.info(f"Fetching notes{f' for item {item_key}' if item_key else ''}")
        limit = _normalize_limit(limit, default=20, maximum=200) if limit is not None else None

        with LocalZoteroReader() as reader:
            notes = reader.get_notes(item_key=item_key, limit=limit, **_reader_kwargs())

        if not notes:
            return f"No notes found{f' for item {item_key}' if item_key else ''}."

        # Generate markdown output
        output = [f"# Notes{f' for Item: {item_key}' if item_key else ''}", ""]

        for i, note in enumerate(notes, 1):
            data = note.get("data", {})
            note_key = note.get("key", "")

            # Parent item context
            parent_info = ""
            if parent_key := data.get("parentItem"):
                with LocalZoteroReader() as reader:
                    parent = reader.get_item_details_by_key(parent_key, **_reader_kwargs())
                parent_info = (
                    f" (from \"{parent['data'].get('title', 'Untitled')}\")"
                    if parent
                    else f" (parent key: {parent_key})"
                )

            note_text = _local_note_text(note, truncate=truncate)

            output.append(f"## Note {i}{parent_info}")
            output.append(f"**Key:** {note_key}")

            # Tags
            if tags := data.get("tags"):
                tag_list = [f"`{tag['tag']}`" for tag in tags]
                if tag_list:
                    output.append(f"**Tags:** {' '.join(tag_list)}")

            output.append(f"**Content:**\n{note_text}")
            output.append("")  # Empty line between notes

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error fetching notes: {str(e)}")
        return f"Error fetching notes: {str(e)}"


@mcp.tool(
    name="zotero_search_notes",
    description="Search for notes across your Zotero library."
)
def search_notes(
    query: str,
    limit: int | str | None = 20,
    *,
    ctx: Context
) -> str:
    """
    Search for notes in your Zotero library.

    Args:
        query: Search query string
        limit: Maximum number of results to return
        ctx: MCP context

    Returns:
        Markdown-formatted search results
    """
    try:
        if not query.strip():
            return "Error: Search query cannot be empty"

        ctx.info(f"Searching Zotero notes for '{query}'")
        limit = _normalize_limit(limit, default=20, maximum=200)

        with LocalZoteroReader() as reader:
            notes = reader.get_notes(limit=None, **_reader_kwargs())

        query_lower = query.lower()
        query_terms = query_lower.split()
        note_results = []

        for note in notes:
            data = note.get("data", {})
            note_text = data.get("note", "").lower()

            if all(term in note_text for term in query_terms):
                # Prepare full note details
                note_result = {
                    "type": "note",
                    "key": note.get("key", ""),
                    "data": data
                }
                note_results.append(note_result)

        all_results = note_results[:limit]
        if not all_results:
            return f"No results found for '{query}'"

        # Format results
        output = [f"# Search Results for '{query}'", ""]

        for i, result in enumerate(all_results, 1):
            data = result["data"]
            key = result["key"]

            parent_info = ""
            if parent_key := data.get("parentItem"):
                with LocalZoteroReader() as reader:
                    parent = reader.get_item_details_by_key(parent_key, **_reader_kwargs())
                parent_info = (
                    f" (from \"{parent['data'].get('title', 'Untitled')}\")"
                    if parent
                    else f" (parent key: {parent_key})"
                )

            note_text = clean_html(data.get("note", ""))
            pos = note_text.lower().find(query_lower)
            if pos >= 0:
                start = max(0, pos - 100)
                end = min(len(note_text), pos + len(query) + 200)
                snippet = note_text[start:end]
                snippet_lower = snippet.lower()
                snippet_pos = snippet_lower.find(query_lower)
                if snippet_pos >= 0:
                    snippet = (
                        snippet[:snippet_pos]
                        + f"**{snippet[snippet_pos:snippet_pos + len(query)]}**"
                        + snippet[snippet_pos + len(query):]
                    )
                note_text = snippet + ("..." if end < len(note_text) else "")
            elif len(note_text) > 500:
                note_text = note_text[:500] + "..."

            output.append(f"## Note {i}{parent_info}")
            output.append(f"**Key:** {key}")

            if tags := data.get("tags"):
                tag_list = [f"`{tag['tag']}`" for tag in tags if tag.get("tag")]
                if tag_list:
                    output.append(f"**Tags:** {' '.join(tag_list)}")

            output.append(f"**Content:**\n{note_text}")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        ctx.error(f"Error searching notes: {str(e)}")
        return f"Error searching notes: {str(e)}"


# --- Minimal wrappers for ChatGPT connectors ---
# These are required for ChatGPT custom MCP servers via web "connectors"
# specific tools required are "search" and "fetch"
# See: https://platform.openai.com/docs/mcp

def _extract_item_key_from_input(value: str) -> str | None:
    """Extract a Zotero item key from a Zotero URL, web URL, or bare key.
    Returns None if no plausible key is found.
    """
    if not value:
        return None
    text = value.strip()

    # Common patterns:
    # - zotero://select/items/<KEY>
    # - zotero://select/library/items/<KEY>
    # - https://www.zotero.org/.../items/<KEY>
    # - bare <KEY>
    patterns = [
        r"zotero://select/(?:library/)?items/([A-Za-z0-9]{8})",
        r"/items/([A-Za-z0-9]{8})(?:[^A-Za-z0-9]|$)",
        r"\b([A-Za-z0-9]{8})\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None

@mcp.tool(
    name="search",
    description="ChatGPT-compatible keyword search wrapper. Returns JSON results."
)
def chatgpt_connector_search(
    query: str,
    *,
    ctx: Context
) -> str:
    """
    Returns a JSON-encoded string with shape {"results": [{"id","title","url"}, ...]}.
    The MCP runtime wraps this string as a single text content item.
    """
    try:
        normalized_query = query.strip()
        if not normalized_query:
            return json.dumps({"results": []}, separators=(",", ":"))

        default_limit = 10
        with LocalZoteroReader() as reader:
            matching_items = _search_local_items(
                reader,
                query=normalized_query,
                qmode="everything",
                limit=default_limit,
                item_type="-attachment",
            )

        result_list = []
        for item in matching_items:
            item_key = item.get("key", "")
            title = item.get("data", {}).get("title", "") or (
                f"Zotero Item {item_key}" if item_key else "Zotero Item"
            )
            result_list.append(
                {
                    "id": item_key or uuid.uuid4().hex[:8],
                    "title": title,
                    "url": f"zotero://select/items/{item_key}" if item_key else "",
                }
            )

        return json.dumps({"results": result_list}, separators=(",", ":"))
    except Exception as e:
        ctx.error(f"Error in search wrapper: {str(e)}")
        return json.dumps({"results": [], "error": str(e)}, separators=(",", ":"))


@mcp.tool(
    name="fetch",
    description="ChatGPT-compatible fetch wrapper. Retrieves fulltext/metadata for a Zotero item by ID."
)
def connector_fetch(
    id: str,
    *,
    ctx: Context
) -> str:
    """
    Returns a JSON-encoded string with shape {"id","title","text","url","metadata":{...}}.
    The MCP runtime wraps this string as a single text content item.
    """
    try:
        item_key = (id or "").strip()
        if not item_key:
            return json.dumps({
                "id": id,
                "title": "",
                "text": "",
                "url": "",
                "metadata": {"error": "missing item key"}
            }, separators=(",", ":"))

        with LocalZoteroReader() as reader:
            item = reader.get_item_details_by_key(item_key, **_reader_kwargs())
            data = item.get("data", {}) if item else {}
            full_text = reader.extract_fulltext_for_item_key(item_key, **_reader_kwargs())
        title = data.get("title", f"Zotero Item {item_key}")
        zotero_url = f"zotero://select/items/{item_key}"
        url = zotero_url

        text_clean = full_text[0] if full_text else ""
        if (not text_clean or len(text_clean.strip()) < 40) and data:
            abstract = data.get("abstractNote", "")
            creators = data.get("creators", [])
            byline = format_creators(creators)
            text_clean = (
                f"{title}\n\n"
                + (f"Authors: {byline}\n" if byline else "")
                + (f"Abstract:\n{abstract}" if abstract else "")
            )

        metadata = {
            "itemType": data.get("itemType", ""),
            "date": data.get("date", ""),
            "key": item_key,
            "doi": data.get("DOI", ""),
            "authors": format_creators(data.get("creators", [])),
            "tags": [t.get("tag", "") for t in (data.get("tags", []) or [])],
            "zotero_url": zotero_url,
            "source": "zotero-mcp"
        }

        return json.dumps({
            "id": item_key,
            "title": title,
            "text": text_clean,
            "url": url,
            "metadata": metadata
        }, separators=(",", ":"))
    except Exception as e:
        ctx.error(f"Error in fetch wrapper: {str(e)}")
        return json.dumps({
            "id": id,
            "title": "",
            "text": "",
            "url": "",
            "metadata": {"error": str(e)}
        }, separators=(",", ":"))
