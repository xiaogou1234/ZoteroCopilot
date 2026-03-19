from typing import Iterable, List, Dict
import os
import re

html_re = re.compile(r"<.*?>")
_SEARCH_SEPARATOR_RE = re.compile(r"[\-_./:]+")
_SEARCH_NON_WORD_RE = re.compile(r"[^\w\s]+", flags=re.UNICODE)
_SEARCH_WHITESPACE_RE = re.compile(r"\s+")

def format_creators(creators: list[dict[str, str]]) -> str:
    """
    Format creator names into a string.

    Args:
        creators: List of creator objects from Zotero.

    Returns:
        Formatted string with creator names.
    """
    names = []
    for creator in creators:
        if "firstName" in creator and "lastName" in creator:
            names.append(f"{creator['lastName']}, {creator['firstName']}")
        elif "name" in creator:
            names.append(creator["name"])
    return "; ".join(names) if names else "No authors listed"


def is_local_mode() -> bool:
    """Return True if running in local mode.

    Local mode is enabled when environment variable `ZOTERO_LOCAL` is set to a
    truthy value ("true", "yes", or "1", case-insensitive).
    """
    value = os.getenv("ZOTERO_LOCAL", "")
    return value.lower() in {"true", "yes", "1"}

def clean_html(raw_html: str) -> str:
    """
    Remove HTML tags from a string.

    Args:
        raw_html: String containing HTML content.
    Returns:
        Cleaned string without HTML tags.
    """
    clean_text = re.sub(html_re, "", raw_html)
    return clean_text


def normalize_search_text(value: str | None) -> str:
    """Normalize text for lightweight keyword matching."""
    if not value:
        return ""

    normalized = value.casefold()
    normalized = _SEARCH_SEPARATOR_RE.sub(" ", normalized)
    normalized = _SEARCH_NON_WORD_RE.sub(" ", normalized)
    normalized = _SEARCH_WHITESPACE_RE.sub(" ", normalized).strip()
    return normalized


def tokenize_search_query(query: str) -> list[str]:
    """Split a user query into normalized search terms."""
    normalized = normalize_search_text(query)
    if not normalized:
        return []
    return [term for term in normalized.split(" ") if term]


def matches_search_query(haystacks: Iterable[str | None], query: str) -> bool:
    """Return True when every normalized query term appears in the haystack."""
    terms = tokenize_search_query(query)
    if not terms:
        return False

    haystack = normalize_search_text(" ".join(value for value in haystacks if value))
    if not haystack:
        return False
    return all(term in haystack for term in terms)
