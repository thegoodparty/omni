import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_SRC = (
    Path(__file__).resolve().parents[2]
    / "experiments"
    / "opposition_research"
    / "attachments"
    / "assemble.py"
)


def _seed_opponent():
    # Shape the agent writes per opponent into scratch/opponents.json: roster
    # essentials only, no summary / facts / websites.
    return {
        "full_name": "Jane Doe",
        "party": "Nonpartisan",
        "incumbent": "Yes",
    }


def _web_add():
    # A late filer surfaced by web search.
    return {
        "full_name": "John Roe",
        "party": None,
        "incumbent": "Unknown",
    }


def _setup_workspace(tmp_path, opponents, race):
    ws = tmp_path / "workspace"
    scratch = ws / "scratch"
    scratch.mkdir(parents=True)
    (ws / "output").mkdir(parents=True)
    shutil.copy(SCRIPT_SRC, ws / "assemble.py")
    (scratch / "opponents.json").write_text(
        json.dumps(opponents), encoding="utf-8"
    )
    # production path: the agent writes derived race fields to _race.json
    (scratch / "_race.json").write_text(json.dumps(race), encoding="utf-8")
    return ws


def _run(ws, extra_env=None):
    env = dict(os.environ)
    env["ASSEMBLE_WORKSPACE"] = str(ws)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(ws / "assemble.py")],
        env=env,
        capture_output=True,
        text=True,
    )


def _artifact(ws):
    return json.loads((ws / "output" / "opposition_research.json").read_text())


def _race(**overrides):
    r = {"candidate_name": "Maria Sanchez", "partisan_type": "nonpartisan"}
    r.update(overrides)
    return r


def test_two_opponents_structured(tmp_path):
    ws = _setup_workspace(tmp_path, [_seed_opponent(), _web_add()], _race())
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip().splitlines()[-1] == "PASS"

    art = _artifact(ws)
    # top-level shape: only opponents
    assert set(art.keys()) == {"opponents"}
    assert len(art["opponents"]) == 2

    jane, john = art["opponents"]
    # slimmed per-opponent contract: no political_summary / key_facts / websites
    assert set(jane.keys()) == {"full_name", "party_affiliation", "incumbent"}
    assert jane["full_name"] == "Jane Doe"
    assert jane["party_affiliation"] == "Nonpartisan"
    assert jane["incumbent"] is True

    assert john["full_name"] == "John Roe"
    assert john["incumbent"] is None


def test_zero_opponents_empty(tmp_path):
    ws = _setup_workspace(tmp_path, [], _race())
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws) == {"opponents": []}


def test_nonpartisan_normalizes_party(tmp_path):
    # Even if a roster row carries a partisan registration label, a nonpartisan
    # race normalizes it to "Nonpartisan".
    opp = _seed_opponent()
    opp["party"] = "Democratic"
    ws = _setup_workspace(tmp_path, [opp], _race(partisan_type="nonpartisan"))
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws)["opponents"][0]["party_affiliation"] == "Nonpartisan"


def test_partisan_uses_party_or_unknown(tmp_path):
    dem = _seed_opponent()
    dem["party"] = "Democratic"
    unknown = _seed_opponent()
    unknown["full_name"] = "No Party Person"
    unknown["party"] = None
    ws = _setup_workspace(tmp_path, [dem, unknown], _race(partisan_type="partisan"))
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    opps = _artifact(ws)["opponents"]
    assert opps[0]["party_affiliation"] == "Democratic"
    assert opps[1]["party_affiliation"] == "Unknown"


def test_incumbent_string_mapping(tmp_path):
    no = _seed_opponent()
    no["full_name"] = "Not Incumbent"
    no["incumbent"] = "No"
    ws = _setup_workspace(tmp_path, [no], _race())
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws)["opponents"][0]["incumbent"] is False


def test_incumbent_raw_boolean(tmp_path):
    # The assembler also accepts a raw boolean / null straight from is_incumbent.
    t = _seed_opponent()
    t["incumbent"] = True
    f = _seed_opponent()
    f["full_name"] = "Challenger"
    f["incumbent"] = False
    u = _seed_opponent()
    u["full_name"] = "Mystery"
    u["incumbent"] = None
    ws = _setup_workspace(tmp_path, [t, f, u], _race(partisan_type="partisan"))
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    opps = _artifact(ws)["opponents"]
    assert [o["incumbent"] for o in opps] == [True, False, None]


def test_candidate_as_opponent_fails(tmp_path):
    bad = _seed_opponent()
    bad["full_name"] = "maria sanchez"  # case-insensitive match against candidate
    ws = _setup_workspace(tmp_path, [bad], _race())
    proc = _run(ws)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert proc.stdout.strip().startswith("FAIL:")
    assert "appears as an opponent" in proc.stdout


def test_candidate_as_opponent_fails_with_accents_and_suffix(tmp_path):
    # Roster carries accents + middle initial + suffix; candidate_name is the
    # plain form. Fuzzy normalization must still catch the self-as-opponent.
    bad = _seed_opponent()
    bad["full_name"] = "María A. Sánchez Jr."
    ws = _setup_workspace(tmp_path, [bad], _race(candidate_name="Maria Sanchez"))
    proc = _run(ws)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "appears as an opponent" in proc.stdout


def test_candidate_as_opponent_fails_with_hyphenated_name(tmp_path):
    # Hyphenated roster name vs spaced candidate_name must still match.
    bad = _seed_opponent()
    bad["full_name"] = "María-José Sánchez"
    ws = _setup_workspace(
        tmp_path, [bad], _race(candidate_name="Maria Jose Sanchez")
    )
    proc = _run(ws)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "appears as an opponent" in proc.stdout


def test_empty_race_file_is_used_not_params_fallback(tmp_path):
    # _race.json exists but is {} -> use it as-is (no partisan_type, so party is
    # NOT normalized). It must NOT silently fall back to PARAMS_JSON; if it did,
    # the nonpartisan partisan_type there would force party_affiliation.
    opp = _seed_opponent()
    opp["party"] = "Democratic"
    ws = _setup_workspace(tmp_path, [opp], {})
    proc = _run(
        ws,
        extra_env={"PARAMS_JSON": json.dumps({"partisan_type": "nonpartisan"})},
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws)["opponents"][0]["party_affiliation"] == "Democratic"


def test_skips_non_dict_entries(tmp_path):
    ws = _setup_workspace(
        tmp_path, [_seed_opponent(), "not an object", [1, 2, 3]], _race()
    )
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert len(_artifact(ws)["opponents"]) == 1


def test_skips_opponent_without_full_name(tmp_path):
    # A row missing / blank full_name is dropped rather than emitted as null
    # (which would violate the output_schema).
    missing = {"party": "Democratic", "incumbent": "No"}
    blank = {"full_name": "   ", "party": "Green", "incumbent": "No"}
    ws = _setup_workspace(
        tmp_path, [_seed_opponent(), missing, blank], _race()
    )
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    opps = _artifact(ws)["opponents"]
    assert len(opps) == 1
    assert opps[0]["full_name"] == "Jane Doe"


def test_missing_opponents_file_yields_empty(tmp_path):
    ws = _setup_workspace(tmp_path, [_seed_opponent()], _race())
    (ws / "scratch" / "opponents.json").unlink()
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws) == {"opponents": []}


def test_non_array_opponents_file_yields_empty(tmp_path):
    # A JSON object (not an array) is rejected, not iterated.
    ws = _setup_workspace(tmp_path, {"not": "a list"}, _race())
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws) == {"opponents": []}


def test_race_falls_back_to_params_json(tmp_path):
    # No _race.json on disk -> assemble reads race fields from PARAMS_JSON.
    # The nonpartisan partisan_type from PARAMS must still normalize the party.
    ws = _setup_workspace(tmp_path, [_seed_opponent()], _race())
    (ws / "scratch" / "_race.json").unlink()
    proc = _run(
        ws,
        extra_env={
            "PARAMS_JSON": json.dumps(
                {"candidate_name": "Maria Sanchez", "partisan_type": "nonpartisan"}
            )
        },
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws)["opponents"][0]["party_affiliation"] == "Nonpartisan"


def test_schema_validation_passes_with_contract_schema(tmp_path):
    ws = _setup_workspace(tmp_path, [_seed_opponent()], _race())
    (ws / "contract_schema.json").write_text(
        json.dumps(
            {
                "type": "object",
                "required": ["opponents"],
                "properties": {"opponents": {"type": "array"}},
            }
        ),
        encoding="utf-8",
    )
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip().splitlines()[-1] == "PASS"
    assert len(_artifact(ws)["opponents"]) == 1


def test_schema_violation_fails_without_writing_artifact(tmp_path):
    ws = _setup_workspace(tmp_path, [_seed_opponent()], _race())
    # Require a top-level field the assembler never emits -> validation fails.
    (ws / "contract_schema.json").write_text(
        json.dumps({"type": "object", "required": ["opponents", "extra_top"]}),
        encoding="utf-8",
    )
    proc = _run(ws)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert proc.stdout.strip().startswith("FAIL:")
    # the bad artifact must NOT be written to the published output dir
    assert not (ws / "output" / "opposition_research.json").exists()


def test_dedupes_same_person_across_rosters(tmp_path):
    # The agent folds the primary roster into the general one, so the same
    # person can land in opponents.json twice; the assembler must publish them
    # once (matched by normalized name, ignoring accents / middle initials).
    a = _seed_opponent()
    b = _seed_opponent()
    b["full_name"] = "Jane A. Doe"  # same person, primary-roster spelling
    ws = _setup_workspace(tmp_path, [a, b], _race())
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    opps = _artifact(ws)["opponents"]
    assert len(opps) == 1
    assert opps[0]["full_name"] == "Jane Doe"


def test_candidate_as_opponent_no_candidate_name_bypass(tmp_path):
    # When _race.json has no candidate_name the self-inclusion guard cannot
    # fire — it silently no-ops. This documents that the bypass is known and
    # expected (candidate_name is optional in _race.json; the contract relies
    # on the agent always writing it).
    bad = _seed_opponent()
    bad["full_name"] = "Maria Sanchez"  # the candidate, but no candidate_name to match
    ws = _setup_workspace(tmp_path, [bad], {"partisan_type": "nonpartisan"})
    proc = _run(ws)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _artifact(ws)["opponents"][0]["full_name"] == "Maria Sanchez"
