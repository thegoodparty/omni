"""Tests for the gotchas-book loader that feeds the governance judges' prompts."""

from __future__ import annotations

import governance_gotchas as gg


def test_loads_the_committed_book():
    text = gg.load_gotchas()
    assert "## Gotchas" in text
    assert "One search is not evidence" in text


def test_missing_file_degrades_to_empty_string(tmp_path):
    assert gg.load_gotchas(tmp_path / "nope.md") == ""


def test_default_path_is_resolved_at_call_time(tmp_path, monkeypatch):
    """Callers pass no argument, so redirecting the module attribute must take effect."""
    book = tmp_path / "book.md"
    book.write_text("REDIRECTED-BOOK")
    monkeypatch.setattr(gg, "DEFAULT_GOTCHAS_PATH", book)
    assert gg.load_gotchas() == "REDIRECTED-BOOK"


def test_unreadable_file_degrades_to_empty_string(tmp_path):
    # A directory at the path raises OSError on read_text, not FileNotFoundError.
    d = tmp_path / "book.md"
    d.mkdir()
    assert gg.load_gotchas(d) == ""


def test_corrupt_encoding_degrades_to_empty_string(tmp_path):
    p = tmp_path / "book.md"
    p.write_bytes(b"\xff\xfe\x00 not utf-8 \xc3")
    assert gg.load_gotchas(p) == ""


def test_prompt_section_wraps_the_text_and_names_it():
    section = gg.gotchas_prompt_section("BOOK-BODY-MARKER")
    assert "BOOK-BODY-MARKER" in section
    assert "known gotchas" in section.lower()


def test_prompt_section_is_empty_when_there_is_no_book():
    assert gg.gotchas_prompt_section("") == ""
    assert gg.gotchas_prompt_section("   \n  ") == ""
