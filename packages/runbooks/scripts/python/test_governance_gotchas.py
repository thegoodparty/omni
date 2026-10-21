"""Tests for the gotchas-book loader that feeds the governance judges' prompts."""

from __future__ import annotations

import governance_gotchas as gg


def test_committed_book_carries_both_judge_markers():
    """A marker typo must fail here, not silently change what the judges are told.
    Without this, a missing marker falls back to the whole file and the split is lost."""
    text = gg.DEFAULT_GOTCHAS_PATH.read_text()
    assert text.count(gg.START_MARKER) == 1
    assert text.count(gg.END_MARKER) == 1
    assert text.index(gg.START_MARKER) < text.index(gg.END_MARKER)


def test_loads_only_the_judge_input_section_of_the_committed_book():
    section = gg.load_gotchas()
    # A judgment trap that changes a verdict: in.
    assert "blank is not zero" in section
    assert "can already be instrumented" in section
    # A tooling defect awaiting a Python fix, and a process rule: out. Neither is
    # actionable by a judge, and both would be pure prompt weight twice a week.
    assert "pre-monorepo row" not in section
    assert "One search is not evidence" not in section
    assert "not the system of record" not in section


def test_judge_input_section_slices_between_the_markers():
    text = f"before\n{gg.START_MARKER}\nINSIDE\n{gg.END_MARKER}\nafter"
    assert gg.judge_input_section(text) == "INSIDE"


def test_missing_markers_fall_back_to_the_whole_file():
    """Asymmetric on purpose: too much context costs tokens, too little blinds both
    judges to every trap."""
    assert gg.judge_input_section("no markers here") == "no markers here"
    assert gg.judge_input_section(f"{gg.START_MARKER}\nx") == f"{gg.START_MARKER}\nx"
    # Reversed markers are malformed, not an empty section.
    reversed_text = f"{gg.END_MARKER}\nx\n{gg.START_MARKER}"
    assert gg.judge_input_section(reversed_text) == reversed_text


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
