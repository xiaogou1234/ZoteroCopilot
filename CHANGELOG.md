# Changelog

All notable changes to this repository are documented here.

## [0.3.0] - 2026-03-19

### Added

- Public plugin build script for Zotero 7 and Zotero 8 XPI artifacts
- Public helper packaging manifest and release build flow
- macOS helper packaging documentation and build script
- Desktop-bridge capability checks and collection-path resolution tools
- Local library, feed, and active-profile discovery improvements
- ChatGPT connector-compatible `search` and `fetch` wrappers
- Packaging and search-wrapper test coverage

### Changed

- Unified the repository, Python/helper, and plugin release story around version `0.3.0`
- Reworked the product story around a local-first helper plus Zotero desktop bridge architecture
- Updated the desktop plugin structure with explicit Zotero 7 and Zotero 8 manifests and a compatibility layer
- Refreshed English and Chinese documentation for end-user installs, source installs, and MCP tool discovery
- Simplified local search behavior and added fulltext fallback for keyword search flows
- Clarified public distribution expectations for helper archives and extracted-directory usage

### Removed

- Semantic search, Chroma/vector-database code paths, and related optional feature plumbing
- Legacy Windows helper spec location in favor of the shared helper packaging manifest
- Obsolete semantic-search tests and historical internal-only wiring

### Breaking

- Semantic search is no longer part of the supported public product path
- The ChatGPT connector `search` wrapper now performs local keyword search rather than semantic retrieval
- Public helper distribution now assumes archive extraction before selecting the executable in Zotero

## [0.1.1] - 2026-03-16

### Changed

- Republished the repository as **ZoteroCopilot**
- Unified the Python/helper version and the Zotero plugin version to `0.1.1`
- Rewrote the public English and Chinese documentation
- Simplified the supported product story to the local-first desktop bridge architecture

### Added

- Bilingual top-level README files
- Bilingual getting-started documentation
- Bilingual architecture documentation
- Bilingual plugin and Windows packaging references

### Removed

- Historical requirement and test-plan documents that were only useful during internal development
- Temporary build and cache artifacts from the tracked repository state
