# MCP Tools Reference

ZoteroCopilot currently exposes 34 MCP tools. This page is a quick reference for choosing the right tool, not a full parameter manual.

## Read and Search

| Tool | What it is for | Typical use |
| --- | --- | --- |
| `zotero_search_items` | Keyword search over local Zotero items | Find papers, books, or reports by title, author, abstract, or other metadata |
| `zotero_search_by_tag` | Tag-focused search with AND, OR, and exclusion logic | Find items already organized with a tag workflow |
| `zotero_get_item_metadata` | Full metadata lookup by item key | Inspect one known item in detail |
| `zotero_get_item_fulltext` | Full-text extraction with metadata fallback | Read the actual content of an attachment-backed item |
| `zotero_get_collections` | Collection tree listing | Discover the library structure before moving or importing |
| `zotero_get_collection_items` | List items in one collection | Browse a known collection |
| `zotero_get_item_children` | Show attachments and child notes | Inspect what belongs to a parent item |
| `zotero_get_tags` | List tags in the active library | Discover the current tag vocabulary |
| `zotero_get_recent` | Show recently added items | Check the latest imports or changes |
| `zotero_advanced_search` | Multi-condition local search | Build structured searches beyond simple keywords |
| `zotero_get_notes` | Read notes, optionally scoped to a parent item | Review reading notes or project notes |
| `zotero_search_notes` | Search note text | Find notes by content rather than item metadata |

## Library, Feed, and Context

| Tool | What it is for | Typical use |
| --- | --- | --- |
| `zotero_get_desktop_plugin_capabilities` | Inspect bridge availability and write capability state | Confirm whether local mutation tools are usable |
| `zotero_resolve_collection_path` | Turn a readable collection path into a stable key | Convert `Research/Agents` into the key needed for automation |
| `zotero_list_libraries` | List user, group, and feed libraries | See what libraries are available before switching |
| `zotero_switch_library` | Change the active library context | Operate on a different user, group, or feed library |
| `zotero_list_feeds` | Show RSS feed subscriptions | Inspect locally tracked feed libraries |
| `zotero_get_feed_items` | Read items inside one feed library | Review feed entries from a known feed |

## Write and Import

| Tool | What it is for | Typical use |
| --- | --- | --- |
| `zotero_create_collection` | Create a collection by name or path | Set up a new project folder structure |
| `zotero_delete_collection` | Delete a collection container only | Remove unused collection folders without deleting the items themselves |
| `zotero_batch_create_collections` | Create multiple collections at once | Prepare a hierarchy for a new project |
| `zotero_batch_delete_collections` | Delete multiple collections at once | Clean up empty or obsolete collection groups |
| `zotero_import_pdf_to_collection` | Import one PDF into a target collection | Add a paper that already exists as a local file |
| `zotero_import_identifier_to_collection` | Import by DOI, ISBN, PMID, or arXiv identifier | Create items when you have an identifier but not a PDF |
| `zotero_import_bibtex_to_collection` | Import from BibTeX or BibLaTeX text | Bring in citation metadata from another workflow |
| `zotero_create_collection_note` | Create a standalone note in a collection | Store project notes not attached to one item |
| `zotero_create_child_note` | Create a note under a parent item | Add reading notes to one specific Zotero item |
| `zotero_batch_import_pdfs_to_collection` | Bulk import PDFs from files or a directory | Ingest a folder of papers into Zotero |
| `zotero_move_items_between_collections` | Move items from one collection to another | Reorganize project collections |
| `zotero_remove_item_from_collection` | Remove one item from one collection only | Keep the item in the library but remove one collection membership |
| `zotero_delete_item` | Move an item to the Zotero trash | Safely delete a library item through the bridge |
| `zotero_batch_update_tags` | Add or remove tags across many matches | Bulk-retag a search result set |

## Connector Compatibility

| Tool | What it is for | Typical use |
| --- | --- | --- |
| `search` | ChatGPT connector-compatible keyword search wrapper | Let connector clients discover Zotero items through the minimal required interface |
| `fetch` | ChatGPT connector-compatible item fetch wrapper | Return text and metadata for one known item in connector mode |

## Related Docs

- [README](../README.md)
- [Getting Started](getting-started.md)
- [Architecture](architecture.md)
