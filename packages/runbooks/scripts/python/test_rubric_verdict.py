"""Tests for rubric_verdict — TSV parsing, GO/NO-GO derivation, and main() exit codes.

Parser contract (load): hash-comments and blank lines are free; gate-named DQ
verdicts ("DQ-faithfulness") normalize to "DQ"; every OTHER skipped line is
counted and returned as `(rows, skipped)` so main() can refuse to gate on a
silently-shrunken sample (one uncommented header line is tolerated).

Regression history:
- cold-judge runs wrote `scores.tsv` with an uncommented header and the verdict
  crashed on `int('judgeA')` — headers/non-data rows must be skipped.
- judges emit "DQ-faithfulness"-style verdicts; dropping those rows hid 1-of-2
  gate splits and produced a FALSE GO.

DELIBERATE CONTRACT CHANGE (silent-row-loss fix): load() returns
`(rows, skipped)` instead of bare `rows`. The pre-existing load tests below
were updated to unpack the tuple; their row-content assertions are unchanged.
"""
import sys
from pathlib import Path

import pytest

import rubric_verdict


def test_load_skips_uncommented_header(tmp_path: Path):
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "uuid\tbatch\tjudgeA\tjudgeB\n"   # uncommented header — must be skipped
        "aaa\tb1\t28\t29\n"
        "bbb\tb1\tDQ\tDQ\n"
        "ccc\tb1\t30\t30\n"
    )
    rows, skipped = rubric_verdict.load(str(tsv))
    # the header row must not survive — but its skip must be counted
    assert all(uuid != "uuid" for uuid, _b, _a, _bb in rows)
    assert len(rows) == 3
    assert skipped == 1
    # every judge value must be DQ or an integer, so main() never hits int('judgeA')
    for _uuid, _batch, a, b in rows:
        for v in (a, b):
            assert v == "DQ" or v.lstrip("-").isdigit(), f"non-data token leaked: {v!r}"


def test_load_normalizes_gate_named_dq_to_dq(tmp_path: Path):
    """Regression: faithfulness_check.py and the build runbook emit gate-named
    verdicts like "DQ-faithfulness". load() used to silently DROP such rows,
    so a 1-of-2 gate split ("DQ-faithfulness" vs "27") vanished and the
    verdict came back GO — inverting the adoption gate."""
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "aaa\tb1\t28\t29\n"
        "bbb\tb1\tDQ-faithfulness\t27\n"
    )
    rows, skipped = rubric_verdict.load(str(tsv))
    assert ("bbb", "b1", "DQ", "27") in rows
    assert len(rows) == 2
    assert skipped == 0  # a normalized DQ-* row is data, not a skip
    v = rubric_verdict.verdict(rows)
    assert v["split_gate"] == [("bbb", "DQ", "27")]
    assert v["checks"]["gate decisions reproducible (no 1-of-2 split)"] is False
    assert v["go"] is False


def test_load_still_skips_hash_comments(tmp_path: Path):
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "# uuid\tbatch\tjudgeA\tjudgeB\n"   # commented header
        "# a note line\n"
        "aaa\tb1\t25\t26\n"
    )
    rows, skipped = rubric_verdict.load(str(tsv))
    assert rows == [("aaa", "b1", "25", "26")]
    assert skipped == 0  # comments (and blank lines) are free, not data loss


def test_load_counts_every_skipped_non_data_line(tmp_path: Path):
    """Silent-row-loss regression: malformed rows ("28.5", "N/A", short lines)
    used to vanish without trace, so a GO could be computed on fewer rows than
    the file holds. load() must report how many lines it dropped."""
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "# a comment\n"
        "\n"
        "uuid\tbatch\tjudgeA\tjudgeB\n"   # header: skipped, counted
        "aaa\tb1\t28\t29\n"
        "ddd\tb1\t28.5\t29\n"             # float: skipped, counted
        "short\tline\n"                    # too few columns: skipped, counted
        "eee\tb1\tN/A\t30\n"              # non-numeric: skipped, counted
    )
    rows, skipped = rubric_verdict.load(str(tsv))
    assert rows == [("aaa", "b1", "28", "29")]
    assert skipped == 4


def test_main_tolerates_one_skipped_line_but_reports_it_on_stderr(
    tmp_path: Path, capsys, monkeypatch
):
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "uuid\tbatch\tjudgeA\tjudgeB\n"   # the single tolerated header
        "aaa\tb1\t28\t29\n"
    )
    monkeypatch.setattr(sys, "argv", ["rubric_verdict.py", str(tsv)])
    with pytest.raises(SystemExit) as e:
        rubric_verdict.main()
    assert e.value.code == 0
    captured = capsys.readouterr()
    assert "skipped 1" in captured.err
    assert "VERDICT: GO" in captured.out


def test_main_refuses_to_gate_on_corrupt_input(tmp_path: Path, capsys, monkeypatch):
    """More than one skipped line means data loss beyond the tolerated header:
    main() must exit 2 and must NOT emit a GO/NO-GO verdict."""
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(
        "uuid\tbatch\tjudgeA\tjudgeB\n"
        "aaa\tb1\t28\t29\n"
        "ddd\tb1\t28.5\t29\n"             # second skip → corrupt input
    )
    monkeypatch.setattr(sys, "argv", ["rubric_verdict.py", str(tsv)])
    with pytest.raises(SystemExit) as e:
        rubric_verdict.main()
    assert e.value.code == 2
    captured = capsys.readouterr()
    assert "skipped 2" in captured.err
    assert "VERDICT" not in captured.out


# --- verdict(): the GO/NO-GO derivation itself (gate splits, spread, blowouts) ---
# This is the reliability gate for adopting a rubric; its branches must be locked.

def _row(uuid, a, b):
    return (uuid, "b1", a, b)


def test_unanimous_dq_is_reproducible_and_does_not_block_go():
    v = rubric_verdict.verdict([_row("u1", "DQ", "DQ"), _row("u2", "27", "28")])
    assert v["disq"] == ["u1"]
    assert v["split_gate"] == []
    # the row AFTER the DQ must still be processed (kills a continue->break mutant)
    assert [g[0] for g in v["graded"]] == ["u2"]
    assert v["go"] is True


def test_all_dq_input_yields_zero_spread_and_gate_only_go():
    v = rubric_verdict.verdict([_row("u1", "DQ", "DQ"), _row("u2", "DQ", "DQ")])
    assert v["graded"] == []
    assert v["max_spread"] == 0
    assert v["mean_spread"] == 0.0
    assert v["disq"] == ["u1", "u2"]
    assert v["blowouts"] == []
    # with nothing graded, go is decided purely by the gate checks — all unanimous, so GO
    assert v["go"] is True


def test_one_of_two_gate_split_blocks_go():
    v = rubric_verdict.verdict([_row("u1", "24", "DQ")])
    assert v["split_gate"] == [("u1", "24", "DQ")]
    assert v["go"] is False
    assert v["checks"]["gate decisions reproducible (no 1-of-2 split)"] is False


def test_spread_at_max_is_go_but_one_over_is_not():
    at_max = rubric_verdict.verdict([_row("u1", "26", "28")])     # spread 2 == MAX_SPREAD
    over = rubric_verdict.verdict([_row("u1", "25", "28")])       # spread 3
    assert at_max["go"] is True and at_max["max_spread"] == 2
    assert over["go"] is False and over["max_spread"] == 3
    assert over["blowouts"] == []  # 3 is over max but NOT a structural blowout


def test_blowout_spread_counts_as_structural_failure():
    v = rubric_verdict.verdict([_row("u1", "23", "28")])  # spread 5 == BLOWOUT
    assert [g[0] for g in v["blowouts"]] == ["u1"]
    assert v["checks"]["zero blowouts (>= 5)"] is False
    assert v["go"] is False


def test_spread_stats_are_exact():
    v = rubric_verdict.verdict([_row("u1", "28", "28"), _row("u2", "26", "28")])
    assert v["max_spread"] == 2
    assert v["mean_spread"] == 1.0
    assert [g[3] for g in v["graded"]] == [0, 2]


@pytest.mark.parametrize(
    "content, expected_code, expected_verdict",
    [
        ("aaa\tb1\t28\t29\n", 0, "VERDICT: GO"),
        ("aaa\tb1\t20\t29\n", 1, "VERDICT: NO-GO"),  # spread 9: blowout
    ],
    ids=["go", "no-go"],
)
def test_main_exit_code_encodes_go_no_go(
    tmp_path: Path, capsys, monkeypatch, content, expected_code, expected_verdict
):
    tsv = tmp_path / "scores.tsv"
    tsv.write_text(content)
    monkeypatch.setattr(sys, "argv", ["rubric_verdict.py", str(tsv)])
    with pytest.raises(SystemExit) as e:
        rubric_verdict.main()
    assert e.value.code == expected_code
    assert expected_verdict in capsys.readouterr().out


def test_main_refuses_to_gate_on_zero_data_rows(tmp_path, monkeypatch, capsys):
    # An empty/header-only scores file must NOT print GO: zero briefings assessed
    # is categorically different from unanimous DQ — nothing was validated at all.
    import sys
    import pytest
    tsv = tmp_path / "empty.tsv"
    tsv.write_text("uuid\tbatch\tjudgeA\tjudgeB\n")
    monkeypatch.setattr(sys, "argv", ["rubric_verdict.py", str(tsv)])
    with pytest.raises(SystemExit) as e:
        rubric_verdict.main()
    assert e.value.code == 2
    assert "zero" in capsys.readouterr().err.lower()


def test_main_refuses_to_gate_on_all_dq_sample(tmp_path: Path, monkeypatch, capsys):
    # Every row a unanimous DQ -> zero graded briefings. verdict() reports GO
    # (the gate checks pass vacuously: no spread, no blowouts, no splits), but a
    # rubric that disqualifies everything had its inter-judge reliability tested on
    # nothing. main() must refuse to adopt (exit 2, cannot-assess), not print GO.
    tsv = tmp_path / "alldq.tsv"
    tsv.write_text("u1\tb1\tDQ\tDQ\nu2\tb1\tDQ\tDQ\n")
    monkeypatch.setattr(sys, "argv", ["rubric_verdict.py", str(tsv)])
    with pytest.raises(SystemExit) as e:
        rubric_verdict.main()
    assert e.value.code == 2
    err = capsys.readouterr().err.lower()
    assert "graded" in err or "dq" in err
