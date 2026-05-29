import json
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

SCRIPT_SRC = (
    Path(__file__).resolve().parents[2]
    / "experiments"
    / "opposition_research"
    / "attachments"
    / "assemble.py"
)


def _fragment_with_facts():
    return {
        "full_name": "Jane Doe",
        "incumbent": "Yes",
        "summary": "Jane Doe is the two-term incumbent on the commission. She has focused on zoning reform.",
        "facts": [
            {
                "text": "Won her last race with 5,000 votes.",
                "source_label": "Local Times",
                "url": "https://example.com/jane-results",
            }
        ],
        "websites": ["https://janedoe.example.com"],
        "no_info": False,
        "markdown_block": (
            "- Jane Doe\n"
            "  - Party affiliation: Nonpartisan (race is nonpartisan)\n"
            "  - Incumbent: Yes\n"
            "  - Political summary: Jane Doe is the two-term incumbent.\n"
            "    - Won her last race with 5,000 votes. ([Local Times](https://example.com/jane-results))\n"
            "  - Websites found:\n"
            "    - https://janedoe.example.com"
        ),
    }


def _fragment_no_info():
    return {
        "full_name": "John Roe",
        "incumbent": "Unknown",
        "summary": None,
        "facts": [],
        "websites": [],
        "no_info": True,
        "markdown_block": (
            "- John Roe\n"
            "  - No public information found as of 2026-05-29. You should conduct local research."
        ),
    }


def _setup_workspace(tmp_path, fragments, params, closing_note=None):
    ws = tmp_path / "workspace"
    scratch = ws / "scratch"
    scratch.mkdir(parents=True)
    (ws / "output").mkdir(parents=True)
    shutil.copy(SCRIPT_SRC, ws / "assemble.py")
    for idx, frag in enumerate(fragments, start=1):
        (scratch / f"opp_{idx:02d}.json").write_text(
            json.dumps(frag), encoding="utf-8"
        )
    if closing_note is not None:
        (scratch / "_closing_note.txt").write_text(closing_note, encoding="utf-8")
    return ws


def _run(ws, params):
    env = dict(os.environ)
    env["PARAMS_JSON"] = json.dumps(params)
    env["ASSEMBLE_WORKSPACE"] = str(ws)
    proc = subprocess.run(
        [sys.executable, str(ws / "assemble.py")],
        env=env,
        capture_output=True,
        text=True,
    )
    return proc


def _artifact(ws):
    return json.loads((ws / "output" / "opposition_research.json").read_text())


def _base_params(**overrides):
    p = {
        "candidate_name": "Maria Sanchez",
        "office_name": "Hazleton City Government Study Commission",
        "state": "PA",
        "partisanType": "nonpartisan",
    }
    p.update(overrides)
    return p


def test_two_fragments_assembles_artifact(tmp_path):
    params = _base_params()
    ws = _setup_workspace(
        tmp_path, [_fragment_with_facts(), _fragment_no_info()], params
    )
    proc = _run(ws, params)

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip().splitlines()[-1] == "PASS"

    art = _artifact(ws)
    assert art["race"]["opponent_count"] == 2
    assert len(art["opponents"]) == 2
    for opp in art["opponents"]:
        assert "markdown_block" not in opp
    assert art["opponents"][0]["full_name"] == "Jane Doe"
    assert art["opponents"][1]["full_name"] == "John Roe"

    assert art["markdown"].startswith("### Opposition Research\n\n")
    jane_block = _fragment_with_facts()["markdown_block"]
    john_block = _fragment_no_info()["markdown_block"]
    assert jane_block in art["markdown"]
    assert john_block in art["markdown"]
    assert art["markdown"].index(jane_block) < art["markdown"].index(john_block)

    assert art["race"]["office_name"] == params["office_name"]
    assert art["race"]["state"] == "PA"
    assert art["race"]["partisanType"] == "nonpartisan"
    assert "generated_at" in art and art["generated_at"]


def test_closing_note_appended(tmp_path):
    params = _base_params(partisanType="partisan")
    note = "Note: 1 additional candidate is running in a different partisan primary for this seat."
    ws = _setup_workspace(
        tmp_path, [_fragment_with_facts()], params, closing_note=note
    )
    proc = _run(ws, params)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    art = _artifact(ws)
    assert art["markdown"].endswith(note)


def test_zero_fragments_uncontested(tmp_path):
    params = _base_params()
    ws = _setup_workspace(tmp_path, [], params)
    proc = _run(ws, params)

    assert proc.returncode == 0, proc.stdout + proc.stderr
    art = _artifact(ws)
    assert art["race"]["opponent_count"] == 0
    assert art["opponents"] == []
    today = date.today().isoformat()
    assert (
        f"No opponents are currently registered for this race as of {today}."
        in art["markdown"]
    )
    assert "Continue to monitor" in art["markdown"]


def test_candidate_name_present_fails(tmp_path):
    params = _base_params()
    bad = _fragment_with_facts()
    bad["markdown_block"] = bad["markdown_block"] + "\n  - Maria Sanchez is the favorite."
    ws = _setup_workspace(tmp_path, [bad], params)
    proc = _run(ws, params)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert proc.stdout.strip().startswith("FAIL:")
    assert "Maria Sanchez".lower() in proc.stdout.lower() or "candidate" in proc.stdout.lower()
    art = _artifact(ws)
    assert art["race"]["opponent_count"] == 1


def test_nonpartisan_party_line_violation_fails(tmp_path):
    params = _base_params()
    bad = _fragment_with_facts()
    bad["markdown_block"] = bad["markdown_block"].replace(
        "Party affiliation: Nonpartisan (race is nonpartisan)",
        "Party affiliation: Democratic",
    )
    ws = _setup_workspace(tmp_path, [bad], params)
    proc = _run(ws, params)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert proc.stdout.strip().startswith("FAIL:")


def test_em_dash_fails(tmp_path):
    params = _base_params()
    bad = _fragment_with_facts()
    bad["markdown_block"] = bad["markdown_block"] + "\n  - Strong record — well known."
    ws = _setup_workspace(tmp_path, [bad], params)
    proc = _run(ws, params)

    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert proc.stdout.strip().startswith("FAIL:")


def test_skips_non_dict_fragment(tmp_path):
    params = _base_params()
    ws = _setup_workspace(tmp_path, [_fragment_with_facts()], params)
    (ws / "scratch" / "opp_99.json").write_text("not json at all", encoding="utf-8")
    (ws / "scratch" / "opp_98.json").write_text("[1, 2, 3]", encoding="utf-8")
    proc = _run(ws, params)

    assert proc.returncode == 0, proc.stdout + proc.stderr
    art = _artifact(ws)
    assert art["race"]["opponent_count"] == 1
