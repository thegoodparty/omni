"""QA-folder publishing behavior for publish_experiments.py (contracts A + F).

Mirrors the attachment-validation contract for the new per-experiment `qa/`
folder: meta-schema (`_schema/qa.schema.json`), path-safety, a separate 1 MiB
cap, qa-only required-file + non-fatal warning rules, and index.json key
emission + hash folding.

These tests construct minimal experiment dirs under tmp_path and point the
module's module-level paths at them — they do NOT depend on the real
meeting_briefing/qa/ folder.

Run: cd scripts/python && uv run pytest test_publish_experiments_qa.py -q
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

import publish_experiments as pub


# ---------------------------------------------------------------------------
# Fixtures: minimal experiment dirs on disk
# ---------------------------------------------------------------------------

GOOD_INPUT_SCHEMA = {"type": "object", "properties": {"x": {"type": "string"}}}
GOOD_OUTPUT_SCHEMA = {"type": "object", "properties": {"y": {"type": "string"}}}


def _write_experiment(
    base: Path,
    slug: str,
    *,
    qa_files: dict[str, str] | None = None,
    manifest_extra: dict | None = None,
) -> Path:
    """Create experiments/<slug>/{manifest.json,instruction.md} and optional
    qa/ files. `qa_files` maps relpath-under-qa -> text body; pass None to
    create no qa/ folder at all."""
    exp = base / slug
    exp.mkdir(parents=True)
    manifest = {
        "id": slug,
        "version": 1,
        "model": "sonnet",
        "max_turns": 20,
        "timeout_seconds": 600,
        "input_schema": GOOD_INPUT_SCHEMA,
        "output_schema": GOOD_OUTPUT_SCHEMA,
    }
    if manifest_extra:
        manifest.update(manifest_extra)
    (exp / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (exp / "instruction.md").write_text(f"# {slug}\n\nDo the thing.\n")
    if qa_files is not None:
        qa = exp / "qa"
        qa.mkdir()
        for relpath, body in qa_files.items():
            target = qa / relpath
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body)
    return exp


@pytest.fixture
def qa_meta_schema() -> dict:
    return pub._load_qa_meta_schema()


# ---------------------------------------------------------------------------
# qa.schema.json shape (contract A)
# ---------------------------------------------------------------------------


def test_qa_schema_requires_blocking(qa_meta_schema):
    validator = Draft7Validator(qa_meta_schema)
    errors = list(validator.iter_errors({}))
    assert errors, "qa.schema.json must reject a manifest with no `blocking`"
    assert "'blocking' is a required property" in " | ".join(e.message for e in errors)


def test_qa_schema_accepts_bare_blocking_false(qa_meta_schema):
    errors = list(Draft7Validator(qa_meta_schema).iter_errors({"blocking": False}))
    assert errors == [], f"bare {{blocking: false}} must validate: {[e.message for e in errors]}"


def test_qa_schema_rejects_unknown_top_level_key(qa_meta_schema):
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors({"blocking": False, "bogus": 1})
    )
    assert errors, "unknown top-level key must be rejected (additionalProperties:false)"
    assert "Additional properties are not allowed" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_unknown_nested_key(qa_meta_schema):
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "deterministic": {"timeout_seconds": 120, "bogus": 1}}
        )
    )
    assert errors, "unknown nested key under deterministic must be rejected"
    assert "Additional properties are not allowed" in " | ".join(e.message for e in errors)


def test_qa_schema_accepts_full_overrides(qa_meta_schema):
    """Two-entrypoint v1 (contract A): the full shape is blocking plus the two
    optional override blocks — deterministic.timeout_seconds (bounds qa/main.py)
    and the agent block (model + budgets for the qa/eval.md evaluator)."""
    full = {
        "blocking": True,
        "deterministic": {"timeout_seconds": 120},
        "agent": {"model": "sonnet", "max_turns": 20, "timeout_seconds": 300},
    }
    errors = list(Draft7Validator(qa_meta_schema).iter_errors(full))
    assert errors == [], f"full override manifest rejected: {[e.message for e in errors]}"


def test_qa_schema_accepts_agent_block(qa_meta_schema):
    """Contract A:38-48: the agent block is the optional model+budgets override
    for the qa/eval.md evaluator. It is harmless on a deterministic-only folder
    and MUST validate (the schema only checks shape)."""
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "agent": {"model": "sonnet"}}
        )
    )
    assert errors == [], f"agent block must validate: {[e.message for e in errors]}"


def test_qa_schema_rejects_agent_model_not_in_enum(qa_meta_schema):
    """agent.model is an enum of sonnet / opus / haiku (contract A:48)."""
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "agent": {"model": "gpt-4"}}
        )
    )
    assert errors, "agent.model outside the sonnet/opus/haiku enum must be rejected"
    assert "is not one of" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_unknown_agent_subkey(qa_meta_schema):
    """additionalProperties:false throughout (contract A:48) — an unknown key
    under agent is a hard rejection, not silent passthrough."""
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "agent": {"model": "sonnet", "bogus": 1}}
        )
    )
    assert errors, "unknown nested key under agent must be rejected"
    assert "Additional properties are not allowed" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_agent_max_turns_below_one(qa_meta_schema):
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "agent": {"max_turns": 0}}
        )
    )
    assert errors, "agent.max_turns must be >= 1"
    assert "less than the minimum" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_repair_block(qa_meta_schema):
    """Deterministic-only v1 dropped the repair block entirely — it is now an
    unknown top-level key, a hard rejection, not a warning."""
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "repair": {"max_rounds": 1}}
        )
    )
    assert errors, "repair block must be rejected in deterministic-only v1"
    assert "Additional properties are not allowed" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_blocking_wrong_type(qa_meta_schema):
    errors = list(Draft7Validator(qa_meta_schema).iter_errors({"blocking": "yes"}))
    assert errors, "blocking must be a boolean"
    assert "is not of type 'boolean'" in " | ".join(e.message for e in errors)


def test_qa_schema_rejects_deterministic_timeout_below_one(qa_meta_schema):
    errors = list(
        Draft7Validator(qa_meta_schema).iter_errors(
            {"blocking": False, "deterministic": {"timeout_seconds": 0}}
        )
    )
    assert errors, "deterministic.timeout_seconds must be >= 1"
    assert "less than the minimum" in " | ".join(e.message for e in errors)


# ---------------------------------------------------------------------------
# _validate_qa: required manifest, no-qa path, path safety, size cap
# ---------------------------------------------------------------------------


def _manifest_of(exp: Path) -> dict:
    return json.loads((exp / "manifest.json").read_text())


def test_validate_qa_returns_none_when_no_qa_folder(tmp_path, qa_meta_schema):
    exp = _write_experiment(tmp_path, "no_qa", qa_files=None)
    result = pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert result is None


def test_validate_qa_requires_manifest_when_qa_folder_exists(tmp_path, qa_meta_schema):
    exp = _write_experiment(tmp_path, "qa_no_manifest", qa_files={"main.py": "print('x')\n"})
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "manifest.json" in str(ei.value)


def test_validate_qa_returns_sorted_relpaths(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_files",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print('x')\n",
            "eval.md": "# rubric\n",
        },
    )
    result = pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    relpaths = [rp for rp, _ in result]
    assert relpaths == ["eval.md", "main.py", "manifest.json"]


def test_validate_qa_rejects_nested_subdir(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_nested",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "sub/helper.py": "x = 1\n",
        },
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "nested subdirectories" in str(ei.value)


def test_validate_qa_rejects_symlink(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_symlink",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    secret = tmp_path / "secret.txt"
    secret.write_text("password\n")
    (exp / "qa" / "link.md").symlink_to(secret)
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "symlink" in str(ei.value)


def test_validate_qa_rejects_non_utf8(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_binary",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    (exp / "qa" / "blob.md").write_bytes(b"\xff\xfe\x00\x01")
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "UTF-8" in str(ei.value)


def test_validate_qa_enforces_one_mib_cap(tmp_path, qa_meta_schema):
    """qa cap is 1 MiB, distinct from the 5 MiB attachment cap. A file that
    fits under the attachment cap but exceeds the qa cap must be rejected."""
    assert pub.QA_TOTAL_SIZE_LIMIT_BYTES == 1 * 1024 * 1024
    assert pub.QA_TOTAL_SIZE_LIMIT_BYTES < pub.ATTACHMENTS_TOTAL_SIZE_LIMIT_BYTES
    big = "a" * (pub.QA_TOTAL_SIZE_LIMIT_BYTES + 1)
    exp = _write_experiment(
        tmp_path,
        "qa_too_big",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "big.md": big},
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    msg = str(ei.value)
    assert "exceeds cap" in msg
    assert str(pub.QA_TOTAL_SIZE_LIMIT_BYTES) in msg


def test_validate_qa_under_one_mib_within_attachment_cap_passes(tmp_path, qa_meta_schema):
    """A 600 KiB qa folder sits under the 1 MiB qa cap (and well under the
    5 MiB attachment cap) — must pass, proving the cap is the qa-specific one."""
    body = "a" * (600 * 1024)
    exp = _write_experiment(
        tmp_path,
        "qa_ok_size",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "big.md": body},
    )
    result = pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert sorted(rp for rp, _ in result) == ["big.md", "manifest.json"]


# ---------------------------------------------------------------------------
# _validate_qa: manifest schema validation
# ---------------------------------------------------------------------------


def test_validate_qa_rejects_manifest_missing_blocking(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_bad_manifest",
        qa_files={"manifest.json": json.dumps({"deterministic": {"timeout_seconds": 120}})},
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "blocking" in str(ei.value)


def test_validate_qa_rejects_manifest_wrong_type(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_wrong_type",
        qa_files={"manifest.json": json.dumps({"blocking": "yes"})},
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "boolean" in str(ei.value)


def test_validate_qa_rejects_manifest_invalid_json(tmp_path, qa_meta_schema):
    exp = _write_experiment(
        tmp_path,
        "qa_bad_json",
        qa_files={"manifest.json": "{not json", "main.py": "print(1)\n"},
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "JSON" in str(ei.value) or "json" in str(ei.value)


# ---------------------------------------------------------------------------
# _validate_qa: non-fatal stderr warnings
# ---------------------------------------------------------------------------


def test_validate_qa_warns_on_entrypoint_less_folder(tmp_path, qa_meta_schema, capsys):
    """A qa/ folder with manifest.json but neither main.py nor eval.md would
    produce a `skipped` verdict at runtime — warn the author, but still publish."""
    exp = _write_experiment(
        tmp_path,
        "qa_no_entrypoint",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "notes.md": "hi\n"},
    )
    result = pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert sorted(rp for rp, _ in result) == ["manifest.json", "notes.md"]
    err = capsys.readouterr().err
    assert "main.py" in err and "eval.md" in err


def test_validate_qa_no_entrypoint_warning_when_main_py_present(tmp_path, qa_meta_schema, capsys):
    exp = _write_experiment(
        tmp_path,
        "qa_has_main",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "main.py": "print(1)\n"},
    )
    pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    err = capsys.readouterr().err
    assert "neither main.py nor eval.md" not in err


def test_validate_qa_rejects_repair_block_as_unknown_key(tmp_path, qa_meta_schema):
    """Deterministic-only v1: a repair block is no longer a warning — it is an
    unknown top-level key the qa meta-schema rejects (additionalProperties:false),
    so _validate_qa raises rather than publishing with a warning."""
    exp = _write_experiment(
        tmp_path,
        "qa_repair",
        qa_files={
            "manifest.json": json.dumps({"blocking": False, "repair": {"max_rounds": 2}}),
            "main.py": "print(1)\n",
        },
    )
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "Additional properties are not allowed" in str(ei.value)


def test_validate_qa_warns_on_blocking_true_write_action(tmp_path, qa_meta_schema, capsys):
    """blocking:true is treated as false until the enforcement path ships, and
    the publisher warns — for every experiment (decision 1 / contract A:48),
    including a write-action manifest."""
    exp = _write_experiment(
        tmp_path,
        "qa_block_write",
        qa_files={
            "manifest.json": json.dumps({"blocking": True}),
            "main.py": "print(1)\n",
        },
        manifest_extra={"permission_mode": "bypassPermissions"},
    )
    pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    err = capsys.readouterr().err
    assert "blocking" in err and "observe" in err


def test_validate_qa_warns_on_blocking_true_read_action(tmp_path, qa_meta_schema, capsys):
    """The blocking:true warning fires for EVERY experiment (decision 1 /
    contract A:48), not only write-action ones — a read-action manifest (no
    system_prompt/permission_mode) must warn too."""
    exp = _write_experiment(
        tmp_path,
        "qa_block_read",
        qa_files={
            "manifest.json": json.dumps({"blocking": True}),
            "main.py": "print(1)\n",
        },
    )
    pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    err = capsys.readouterr().err
    assert "blocking" in err and "observe" in err


def test_validate_qa_no_blocking_warning_when_false(tmp_path, qa_meta_schema, capsys):
    """blocking:false (the only posture v1 enforces) must NOT trigger the
    blocking warning."""
    exp = _write_experiment(
        tmp_path,
        "qa_observe",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
        },
    )
    pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    err = capsys.readouterr().err
    assert "blocking:true" not in err


# ---------------------------------------------------------------------------
# _build_index: qa keys + hash folding (contract F + decision 10)
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_experiments(tmp_path, monkeypatch):
    """Redirect the module's experiment discovery at a temp experiments root so
    _build_index/_experiment_dirs walk only our fixtures (not the repo's real
    experiments, which a different workstream is actively editing). The real
    qa.schema.json on disk is still used to validate qa manifests."""
    exp_root = tmp_path / "experiments"
    exp_root.mkdir()
    monkeypatch.setattr(pub, "EXPERIMENTS_DIR", exp_root)
    return exp_root


def test_build_index_omits_qa_keys_when_no_qa_folder(patched_experiments):
    _write_experiment(patched_experiments, "plain", qa_files=None)
    index, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    entry = next(e for e in index["experiments"] if e["id"] == "plain")
    assert "qa_manifest_key" not in entry
    assert "qa_keys" not in entry


def test_build_index_emits_qa_keys_when_qa_folder_present(patched_experiments):
    _write_experiment(
        patched_experiments,
        "withqa",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    index, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    entry = next(e for e in index["experiments"] if e["id"] == "withqa")
    assert entry["qa_manifest_key"] == "withqa/qa/manifest.json"
    assert entry["qa_keys"] == ["withqa/qa/eval.md", "withqa/qa/main.py"]


def test_build_index_qa_keys_exclude_manifest(patched_experiments):
    """qa_keys carries the non-manifest files only; qa/manifest.json rides
    qa_manifest_key (contract F)."""
    _write_experiment(
        patched_experiments,
        "withqa2",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
        },
    )
    index, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    entry = next(e for e in index["experiments"] if e["id"] == "withqa2")
    assert "withqa2/qa/manifest.json" not in entry["qa_keys"]
    assert entry["qa_keys"] == ["withqa2/qa/main.py"]


def test_build_index_hash_changes_when_qa_body_changes(patched_experiments):
    _write_experiment(
        patched_experiments,
        "hashexp",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
        },
    )
    index1, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    hash1 = next(e for e in index1["experiments"] if e["id"] == "hashexp")["hash"]

    (patched_experiments / "hashexp" / "qa" / "main.py").write_text("print(2)\n")
    index2, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    hash2 = next(e for e in index2["experiments"] if e["id"] == "hashexp")["hash"]

    assert hash1 != hash2, "a qa-only body change must flip the index hash digest"


def test_build_index_hash_identical_to_no_qa_when_no_qa_folder(patched_experiments):
    """Decision 10: an experiment with no qa folder hashes exactly as it would
    pre-gate. Frozen against a PINNED literal (computed once) rather than
    re-derived through _hash_pair — a re-derivation tautologically tracks any
    _hash_pair change, so a regression that altered the byte framing for a no-qa
    experiment would pass a self-referential assertion. The literal locks the
    decision-10 byte-identical guarantee."""
    _write_experiment(patched_experiments, "nofold", qa_files=None)
    index, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    entry = next(e for e in index["experiments"] if e["id"] == "nofold")
    assert entry["hash"] == (
        "sha256:482e20e964c4bc3b33789bee5659644e33fddd7e6bfb46acc3c75c9e39be19d4"
    )


# ---------------------------------------------------------------------------
# Fix 7: _validate_qa branch coverage — output/ prefix + resolved-containment
# escape (only nested + symlink were covered)
# ---------------------------------------------------------------------------


def test_validate_qa_rejects_output_prefix(tmp_path, qa_meta_schema):
    """'output/' is reserved for runtime artifacts under /workspace/output/.
    A qa file under output/ must be rejected (the rule fires BEFORE the
    nested-dir rule, so the message is the output/ one, not the nested one)."""
    exp = _write_experiment(
        tmp_path,
        "qa_output_prefix",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    (exp / "qa" / "output").mkdir()
    (exp / "qa" / "output" / "leak.md").write_text("artifact\n")
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    msg = str(ei.value)
    assert "output/" in msg
    assert "reserved" in msg


def test_validate_qa_rejects_resolved_containment_escape(tmp_path, qa_meta_schema, monkeypatch):
    """A qa entry that resolves outside the qa/ dir (e.g. via a symlinked
    PARENT directory, which is not itself caught by the per-file is_symlink
    check) must be rejected by the resolved-containment guard."""
    exp = _write_experiment(
        tmp_path,
        "qa_escape",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    # A real file OUTSIDE the qa/ dir. We forge a Path that REPORTS a flat
    # relpath under qa/ and is_symlink()==False, but resolve()s outside qa/ —
    # exactly the bind-mount / resolved-parent-symlink quirk the containment
    # guard exists for. Driving it through the walker is the only deterministic
    # way to reach this branch (a flat-layout filesystem trips the nested or
    # symlink guard first).
    outside = tmp_path / "outside_dir"
    outside.mkdir()
    escapee_real = outside / "evil.md"
    escapee_real.write_text("secret\n")
    real_files = pub._qa_files(exp)

    class _EscapingPath:
        """Quacks like the Path the walker yields: a flat name under qa/, not a
        symlink, but resolving outside qa/."""

        name = "evil.md"

        def relative_to(self, other):
            return Path("evil.md")

        def is_symlink(self):
            return False

        def resolve(self):
            return escapee_real.resolve()

    monkeypatch.setattr(pub, "_qa_files", lambda _d: [*real_files, _EscapingPath()])
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "resolves outside" in str(ei.value)


# ---------------------------------------------------------------------------
# Fix 2: security parity — TOCTOU-free read, backslash / control-char reject.
# Both rules live in the shared helper, so attachments AND qa enforce them.
# ---------------------------------------------------------------------------


def test_validate_qa_rejects_backslash_in_relpath(tmp_path, qa_meta_schema, monkeypatch):
    """A relpath containing a backslash is rejected ('illegal character').
    Defends downstream separator-sensitive consumers. POSIX filesystems allow
    a literal backslash in a filename, so we create one directly."""
    exp = _write_experiment(
        tmp_path,
        "qa_backslash",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    (exp / "qa" / "a\\b.md").write_text("x\n")
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "illegal character" in str(ei.value)


def test_validate_qa_rejects_control_char_in_relpath(tmp_path, qa_meta_schema):
    """A relpath containing an ASCII control char is rejected ('illegal
    character')."""
    exp = _write_experiment(
        tmp_path,
        "qa_ctrl",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    (exp / "qa" / "a\tb.md").write_text("x\n")
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "illegal character" in str(ei.value)


def test_validate_attachments_rejects_backslash_in_relpath(tmp_path):
    """Parity: the shared helper enforces the backslash rule on the attachment
    path too (same defense, same message substring)."""
    exp = _write_experiment(tmp_path, "att_backslash", qa_files=None)
    att = exp / "attachments"
    att.mkdir()
    (att / "a\\b.md").write_text("x\n")
    with pytest.raises(pub.AttachmentValidationError) as ei:
        pub._validate_attachments(exp)
    assert "illegal character" in str(ei.value)


def test_validate_attachments_rejects_control_char_in_relpath(tmp_path):
    """Parity: control-char reject on attachments too."""
    exp = _write_experiment(tmp_path, "att_ctrl", qa_files=None)
    att = exp / "attachments"
    att.mkdir()
    (att / "a\nb.md").write_text("x\n")
    with pytest.raises(pub.AttachmentValidationError) as ei:
        pub._validate_attachments(exp)
    assert "illegal character" in str(ei.value)


def test_validate_qa_toctou_free_read_enforces_cap_without_st_size(tmp_path, qa_meta_schema, monkeypatch):
    """Fix 2a: the cap is enforced by a bounded READ, NOT by a
    stat().st_size-then-read pair (the TOCTOU race — a file can grow between
    the stat and the read). Proof: make every stat_result's `.st_size` raise.
    Discovery (`is_file()`) may stat, but the SIZE DECISION must never read
    `.st_size`; validation must still reject the over-cap folder via the read."""
    monkeypatch.setattr(pub, "QA_TOTAL_SIZE_LIMIT_BYTES", 1024)
    big = "a" * 4096
    exp = _write_experiment(
        tmp_path,
        "qa_toctou",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "big.md": big},
    )

    class _NoSizeStat:
        def __init__(self, r):
            self._r = r

        def __getattr__(self, name):
            if name == "st_size":
                raise AssertionError(
                    "size check must not read stat().st_size (TOCTOU race)"
                )
            return getattr(self._r, name)

    real_path_stat = Path.stat

    def wrapped_stat(self, *a, **k):
        return _NoSizeStat(real_path_stat(self, *a, **k))

    monkeypatch.setattr(Path, "stat", wrapped_stat)
    with pytest.raises(pub.QaValidationError) as ei:
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    assert "exceeds cap" in str(ei.value)


def test_validate_qa_bounded_read_does_not_slurp_whole_file(tmp_path, qa_meta_schema, monkeypatch):
    """Fix 2a: the read is bounded to (remaining budget + 1) bytes — it must
    NOT read the entire over-cap file into memory. We assert the read size
    passed to file.read() never exceeds remaining_budget + 1."""
    monkeypatch.setattr(pub, "QA_TOTAL_SIZE_LIMIT_BYTES", 1024)
    big = "a" * (1024 * 1024)  # 1 MiB file, cap is 1 KiB
    exp = _write_experiment(
        tmp_path,
        "qa_bounded",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "big.md": big},
    )

    captured_read_sizes: list[int] = []
    import builtins

    real_open = builtins.open

    class _SpyFile:
        def __init__(self, f):
            self._f = f

        def read(self, n=-1):
            captured_read_sizes.append(n)
            return self._f.read(n)

        def __enter__(self):
            self._f.__enter__()
            return self

        def __exit__(self, *a):
            return self._f.__exit__(*a)

    def spy_open(path, mode="r", *a, **k):
        f = real_open(path, mode, *a, **k)
        if "b" in mode and str(path).endswith("big.md"):
            return _SpyFile(f)
        return f

    monkeypatch.setattr(builtins, "open", spy_open)
    with pytest.raises(pub.QaValidationError):
        pub._validate_qa(exp, qa_meta_schema, _manifest_of(exp))
    # The over-cap file's read must be bounded — never the full 1 MiB.
    assert captured_read_sizes, "expected a bounded read on big.md"
    assert max(captured_read_sizes) <= pub.QA_TOTAL_SIZE_LIMIT_BYTES + 1, (
        f"read was not bounded to remaining budget + 1: {captured_read_sizes}"
    )


# ---------------------------------------------------------------------------
# Fake S3 client + publish() seam tests (fixes 3, 4, 5, 6)
#
# publish() must accept an injected s3 client so the upload/list/delete seam
# is testable without boto3/AWS. The fake records the ORDER of put/list/delete
# calls so we can assert qa objects PUT before index.json and reclamation
# AFTER the index switch.
# ---------------------------------------------------------------------------


class FakeS3:
    """In-memory S3 double. Records every operation in `calls` (ordered) and
    keeps a bucket->key->body store so list/delete reflect prior puts."""

    def __init__(self):
        self.store: dict[str, dict[str, bytes]] = {}
        self.calls: list[tuple] = []
        self.fail_delete_access_denied = False

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.store.setdefault(Bucket, {})[Key] = Body
        self.calls.append(("put", Key))

    def get_object(self, Bucket, Key):
        # PR #87's merge-aware publisher reads the live index.json before a dev
        # publish. Mirror real S3: return the stored body, or raise NoSuchKey
        # ("fresh bucket") when it was never PUT. A "get" call is recorded only
        # on the hit path so the empty-bucket tests' `calls` sequences are
        # unchanged.
        store = self.store.get(Bucket, {})
        if Key not in store:
            from botocore.exceptions import ClientError
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "not found"}},
                "GetObject",
            )
        self.calls.append(("get", Key))
        return {"Body": io.BytesIO(store[Key])}

    def list_objects_v2(self, Bucket, Prefix):
        self.calls.append(("list", Prefix))
        keys = [k for k in self.store.get(Bucket, {}) if k.startswith(Prefix)]
        if not keys:
            return {}
        return {"Contents": [{"Key": k} for k in sorted(keys)]}

    def delete_objects(self, Bucket, Delete):
        keys = [o["Key"] for o in Delete["Objects"]]
        self.calls.append(("delete", tuple(sorted(keys))))
        if self.fail_delete_access_denied:
            from botocore.exceptions import ClientError
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "denied"}},
                "DeleteObjects",
            )
        for k in keys:
            self.store.get(Bucket, {}).pop(k, None)
        return {"Deleted": [{"Key": k} for k in keys]}


def _put_keys(fake: FakeS3) -> list[str]:
    return [k for op, k in fake.calls if op == "put"]


def _index_put_position(fake: FakeS3) -> int:
    for i, (op, k) in enumerate(fake.calls):
        if op == "put" and k == "index.json":
            return i
    raise AssertionError("index.json was never PUT")


# ---------------------------------------------------------------------------
# Fix 6b: qa objects PUT before index.json; manifest uploads even with no
# entrypoint; a no-qa experiment's key set is byte-identical to pre-gate.
# ---------------------------------------------------------------------------


def test_publish_uploads_qa_objects_before_index(patched_experiments):
    _write_experiment(
        patched_experiments,
        "seamqa",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    fake = FakeS3()
    rc = pub.publish("dev", s3=fake)
    assert rc == 0
    idx_pos = _index_put_position(fake)
    qa_puts = [
        i for i, (op, k) in enumerate(fake.calls)
        if op == "put" and "/qa/" in k
    ]
    assert qa_puts, "expected qa objects to be PUT"
    assert max(qa_puts) < idx_pos, "every qa object must be PUT before index.json"


def test_publish_uploads_qa_manifest_even_with_no_entrypoint(patched_experiments):
    """An entrypoint-less qa folder (manifest.json only, qa_keys==[]) must still
    upload qa/manifest.json — the gate needs the blocking decision regardless."""
    _write_experiment(
        patched_experiments,
        "seamnoentry",
        qa_files={"manifest.json": json.dumps({"blocking": False})},
    )
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    assert "seamnoentry/qa/manifest.json" in _put_keys(fake)


def test_publish_no_qa_key_set_byte_identical_to_pre_gate(patched_experiments):
    """A no-qa experiment's uploaded key set is manifest.json + instruction.md
    + attachments ONLY — byte-identical to pre-gate (decision 10). No /qa/ key
    is ever PUT for it."""
    exp = _write_experiment(patched_experiments, "seamnoqa", qa_files=None)
    att = exp / "attachments"
    att.mkdir()
    (att / "data.txt").write_text("hello\n")
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    puts = set(_put_keys(fake))
    assert puts == {
        "seamnoqa/manifest.json",
        "seamnoqa/instruction.md",
        "seamnoqa/attachments/data.txt",
        "index.json",
    }
    assert not any("/qa/" in k for k in puts)


# ---------------------------------------------------------------------------
# Fix 6a: qa keys yield consumer basenames
# ---------------------------------------------------------------------------


def test_qa_keys_yield_consumer_basenames(patched_experiments):
    """For a qa folder {manifest.json, main.py, eval.md}, qa_manifest_key and
    every qa_keys entry must start with '<id>/qa/' and the segment after
    '/qa/' is the bare basename with no further '/' (the consumer's
    version-pinner splits on '/qa/' and expects a basename)."""
    _write_experiment(
        patched_experiments,
        "basenames",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    index, _, _ = pub._build_index("dev", pub._experiment_dirs(), pub._load_meta_schema())
    entry = next(e for e in index["experiments"] if e["id"] == "basenames")
    for key in [entry["qa_manifest_key"], *entry["qa_keys"]]:
        assert key.startswith("basenames/qa/")
        basename = key.split("/qa/", 1)[1]
        assert "/" not in basename, f"{key} has a non-basename tail"


# ---------------------------------------------------------------------------
# Fix 6c: index.json json roundtrip preserves qa-key presence / absence
# ---------------------------------------------------------------------------


def test_index_json_roundtrip_preserves_qa_presence_and_absence(patched_experiments):
    _write_experiment(
        patched_experiments,
        "withqa_rt",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
        },
    )
    _write_experiment(patched_experiments, "noqa_rt", qa_files=None)
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    written = fake.store["agent-experiment-metadata-dev"]["index.json"]
    parsed = json.loads(written.decode())
    by_id = {e["id"]: e for e in parsed["experiments"]}
    # qa experiment: keys present and truthy after roundtrip
    assert by_id["withqa_rt"].get("qa_manifest_key") == "withqa_rt/qa/manifest.json"
    assert by_id["withqa_rt"].get("qa_keys") == ["withqa_rt/qa/main.py"]
    # no-qa experiment: keys absent — entry.get() is falsy (consumer truthiness)
    assert by_id["noqa_rt"].get("qa_manifest_key") is None
    assert by_id["noqa_rt"].get("qa_keys") is None


# ---------------------------------------------------------------------------
# Fix 3: validation + warnings happen EXACTLY ONCE per publish (no double walk)
# ---------------------------------------------------------------------------


def test_publish_emits_each_author_warning_exactly_once(patched_experiments, capsys):
    """A single publish must emit each qa author warning exactly once. Before
    fix 3, _validate_qa ran twice (once in _validate_all, once in _build_index)
    so every warning printed twice.

    Two author warnings: the entrypoint-less folder warning and the
    blocking:true warning (now universal — fires for every experiment).
    Trigger both in one experiment and assert each prints exactly once."""
    _write_experiment(
        patched_experiments,
        "warnonce",
        qa_files={
            "manifest.json": json.dumps({"blocking": True}),  # -> blocking warning
            "notes.md": "hi\n",  # no main.py / eval.md -> entrypoint warning
        },
    )
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    err = capsys.readouterr().err
    assert err.count("neither main.py nor eval.md") == 1, (
        f"entrypoint warning must appear exactly once, got:\n{err}"
    )
    assert err.count("blocking:true is accepted") == 1, (
        f"blocking:true warning must appear exactly once, got:\n{err}"
    )


def test_publish_validates_qa_once_per_experiment(patched_experiments, monkeypatch):
    """_validate_qa is invoked exactly once per experiment per publish — the
    validated result is threaded from _validate_all into _build_index, not
    recomputed."""
    _write_experiment(
        patched_experiments,
        "spy1",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "main.py": "print(1)\n"},
    )
    _write_experiment(
        patched_experiments,
        "spy2",
        qa_files={"manifest.json": json.dumps({"blocking": False}), "eval.md": "# r\n"},
    )

    calls: list[str] = []
    real = pub._validate_qa

    def spy(exp_dir, *a, **k):
        calls.append(exp_dir.name)
        return real(exp_dir, *a, **k)

    monkeypatch.setattr(pub, "_validate_qa", spy)
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    assert sorted(calls) == ["spy1", "spy2"], (
        f"_validate_qa must run once per experiment, got: {calls}"
    )


# ---------------------------------------------------------------------------
# Fix 4: dry-run prints qa/manifest.json exactly once with its byte count
# ---------------------------------------------------------------------------


def test_dry_run_prints_qa_manifest_once_with_byte_count(patched_experiments, capsys):
    manifest_body = json.dumps({"blocking": False})
    _write_experiment(
        patched_experiments,
        "dryqa",
        qa_files={"manifest.json": manifest_body, "main.py": "print(1)\n"},
    )
    rc = pub.publish("dev", dry_run=True)
    assert rc == 0
    out = capsys.readouterr().out
    assert out.count("dryqa/qa/manifest.json") == 1, (
        f"qa/manifest.json must be printed exactly once in dry-run, got:\n{out}"
    )
    # its byte count must appear on that single line
    byte_count = len(manifest_body.encode())
    assert f"({byte_count:,} bytes)" in out


# ---------------------------------------------------------------------------
# Fix 5: orphan reclamation — stale qa objects deleted AFTER the index switch;
# AccessDenied on delete never fails the publish.
# ---------------------------------------------------------------------------


def test_publish_reclaims_stale_qa_object_after_index_put(patched_experiments):
    """Publish with a qa file present, then republish with it removed. The
    stale S3 object must be deleted, AND the delete must happen AFTER the
    index.json PUT (reclaiming before the atomic switch would transiently
    dangle the still-live OLD index)."""
    _write_experiment(
        patched_experiments,
        "reclaim",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    bucket = "agent-experiment-metadata-dev"
    assert "reclaim/qa/eval.md" in fake.store[bucket]

    # Remove eval.md and republish on the SAME fake (state persists).
    (patched_experiments / "reclaim" / "qa" / "eval.md").unlink()
    fake.calls.clear()
    pub.publish("dev", s3=fake)

    # The stale object is gone.
    assert "reclaim/qa/eval.md" not in fake.store[bucket]
    # The delete happened after index.json PUT.
    idx_pos = _index_put_position(fake)
    delete_positions = [
        i for i, (op, _k) in enumerate(fake.calls) if op == "delete"
    ]
    assert delete_positions, "expected a delete_objects call"
    assert min(delete_positions) > idx_pos, (
        "reclamation must run AFTER the index.json atomic switch"
    )
    # And the deleted key set included the stale eval.md.
    deleted_keys = {
        k for op, keys in fake.calls if op == "delete" for k in keys
    }
    assert "reclaim/qa/eval.md" in deleted_keys


def test_publish_does_not_reclaim_live_qa_objects(patched_experiments):
    """Reclamation must delete only objects NOT in this publish's emitted set —
    the still-live qa/manifest.json + main.py must survive."""
    _write_experiment(
        patched_experiments,
        "keep",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    (patched_experiments / "keep" / "qa" / "eval.md").unlink()
    pub.publish("dev", s3=fake)
    bucket = "agent-experiment-metadata-dev"
    assert "keep/qa/manifest.json" in fake.store[bucket]
    assert "keep/qa/main.py" in fake.store[bucket]
    assert "keep/qa/eval.md" not in fake.store[bucket]


def test_publish_survives_access_denied_on_reclaim(patched_experiments, capsys):
    """A missing s3:DeleteObject permission must NEVER fail the publish —
    reclamation is wrapped in try/except ClientError and degrades to a
    warning. publish() still returns 0."""
    _write_experiment(
        patched_experiments,
        "denied",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
            "eval.md": "# rubric\n",
        },
    )
    fake = FakeS3()
    pub.publish("dev", s3=fake)
    (patched_experiments / "denied" / "qa" / "eval.md").unlink()
    fake.fail_delete_access_denied = True
    rc = pub.publish("dev", s3=fake)
    assert rc == 0, "AccessDenied on reclaim must not fail the publish"
    err = capsys.readouterr().err
    assert "reclaim" in err.lower() or "AccessDenied" in err


def test_publish_dry_run_does_not_delete(patched_experiments, capsys):
    """--dry-run must never issue a real delete; it prints 'would reclaim'
    instead. We seed a stale object directly into the fake store, run a
    dry-run publish, and assert no delete_objects call and the object survives."""
    _write_experiment(
        patched_experiments,
        "drynodel",
        qa_files={
            "manifest.json": json.dumps({"blocking": False}),
            "main.py": "print(1)\n",
        },
    )
    fake = FakeS3()
    bucket = "agent-experiment-metadata-dev"
    fake.store.setdefault(bucket, {})["drynodel/qa/stale.md"] = b"old\n"
    rc = pub.publish("dev", dry_run=True, s3=fake)
    assert rc == 0
    assert ("delete", ) not in [(op,) for op, *_ in fake.calls]
    assert not any(op == "delete" for op, *_ in fake.calls)
    assert "drynodel/qa/stale.md" in fake.store[bucket], "dry-run must not delete"
    out = capsys.readouterr().out
    assert "would reclaim" in out
