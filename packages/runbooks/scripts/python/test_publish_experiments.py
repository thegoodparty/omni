"""Tests for the single-experiment publish + dev sandbox-preservation logic
added to publish_experiments.py.

The index-composition policy (`_compose_index_entries`) is a pure function and
gets the bulk of the coverage with no AWS. `_fetch_live_index` is exercised via
botocore's Stubber (ships with boto3, no extra dep). The publish() guard rails
(--only dev-only, unknown experiment) return before any S3 call, so they need
no stubbing.
"""

import io
import json
import shutil

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import Stubber

import publish_experiments as pe


@pytest.fixture
def hermetic_experiment_tree(tmp_path, monkeypatch):
    """A minimal real experiments tree: the actual meta-schema + ONE real
    experiment copied into tmp_path, with EXPERIMENTS_DIR/META_SCHEMA_PATH
    pointed at it. Lets a full publish() run end-to-end (real _experiment_dirs,
    _validate_all, _build_index, and the upload loop's on-disk manifest/
    instruction reads) without depending on the whole real roster — a future
    experiment that fails schema validation can't break this test. Mirrors
    test_publish_safety.py's real_experiment_tree."""
    root = tmp_path / "experiments"
    root.mkdir()
    shutil.copytree(pe.EXPERIMENTS_DIR / "_schema", root / "_schema")
    src = sorted(
        p for p in pe.EXPERIMENTS_DIR.iterdir()
        if p.is_dir() and (p / "manifest.json").exists() and not p.name.startswith((".", "_"))
    )[0]
    shutil.copytree(src, root / src.name)
    monkeypatch.setattr(pe, "EXPERIMENTS_DIR", root)
    monkeypatch.setattr(pe, "META_SCHEMA_PATH", root / "_schema" / "manifest.schema.json")
    return root


def _entry(id_: str, version: int = 1) -> dict:
    return {
        "id": id_,
        "version": version,
        "manifest_key": f"{id_}/manifest.json",
        "instruction_key": f"{id_}/instruction.md",
        "attachment_keys": [],
        "hash": f"sha256:{id_}",
    }


# ---------- _is_sandbox ----------


@pytest.mark.parametrize(
    "id_,expected",
    [
        ("sandbox_oppo", True),
        ("feliks_sandbox", True),
        ("oppo_sandbox_v2", True),
        ("opposition_research", False),
        ("opportunities_and_challenges", False),
        ("SANDBOX_x", False),  # marker is lowercase; ids are lowercase by contract
        ("", False),  # the str("") fallback when an entry lacks an id
    ],
)
def test_is_sandbox(id_, expected):
    assert pe._is_sandbox(id_) is expected


# ---------- _valid_carryforward ----------


def test_valid_carryforward_accepts_canonical_entry():
    e = _entry("opposition_research")
    e["attachment_keys"] = ["opposition_research/attachments/roster.md"]
    assert pe._valid_carryforward(e) is True


@pytest.mark.parametrize(
    "mutate",
    [
        {"id": "Bad-Id"},  # fails the id pattern
        {"id": "sandbox_x\n"},  # trailing newline must not pass (\\Z anchor)
        {"manifest_key": "ATTACKER/manifest.json"},  # non-canonical manifest key
        {"instruction_key": "ATTACKER/instruction.md"},  # non-canonical instr key
        {"attachment_keys": ["../../etc/passwd"]},  # non-canonical attachment key
        {"attachment_keys": "notalist"},  # wrong type
        # Traversal INSIDE the canonical prefix — a bare startswith() check
        # would accept these, so the suffix rules are load-bearing here.
        {"attachment_keys": ["sandbox_x/attachments/../../etc/passwd"]},
        {"attachment_keys": ["sandbox_x/attachments/.."]},
        {"attachment_keys": ["sandbox_x/attachments/nested/file.md"]},  # not flat
        {"attachment_keys": ["sandbox_x/attachments/"]},  # empty basename
        {"attachment_keys": ["sandbox_x/attachments/a\nb"]},  # control char
    ],
)
def test_valid_carryforward_rejects_drift(mutate):
    e = _entry("sandbox_x")
    e.update(mutate)
    assert pe._valid_carryforward(e) is False


def test_valid_carryforward_rejects_non_dict():
    # A live `experiments` element that isn't an object is drift, not a crash.
    assert pe._valid_carryforward("junk") is False
    assert pe._valid_carryforward(None) is False


def test_valid_carryforward_accepts_canonical_qa_pair():
    e = _entry("sandbox_x")
    e["qa_manifest_key"] = "sandbox_x/qa/manifest.json"
    e["qa_keys"] = ["sandbox_x/qa/main.py"]
    assert pe._valid_carryforward(e) is True
    # A manifest-only qa/ folder publishes an empty qa_keys list — still a pair.
    e["qa_keys"] = []
    assert pe._valid_carryforward(e) is True


@pytest.mark.parametrize(
    "mutate",
    [
        # Only one of the qa fields present is drift: the publisher always emits
        # them as a matched pair, so an asymmetric entry can't be carried forward.
        {"qa_manifest_key": "sandbox_x/qa/manifest.json"},
        {"qa_keys": ["sandbox_x/qa/main.py"]},
        {"qa_manifest_key": "ATTACKER/qa/manifest.json", "qa_keys": []},
        {"qa_manifest_key": "sandbox_x/qa/manifest.json", "qa_keys": "notalist"},
        {
            "qa_manifest_key": "sandbox_x/qa/manifest.json",
            "qa_keys": ["sandbox_x/qa/../../etc/passwd"],
        },
    ],
)
def test_valid_carryforward_rejects_qa_drift(mutate):
    e = _entry("sandbox_x")
    e.update(mutate)
    assert pe._valid_carryforward(e) is False


# ---------- _compose_index_entries ----------


def test_only_inserts_new_entry_preserving_others():
    live = [_entry("opposition_research"), _entry("sandbox_x")]
    new = [_entry("sandbox_new")]
    out = pe._compose_index_entries(new, live, only_id="sandbox_new", env="dev")
    ids = [e["id"] for e in out]
    assert ids == sorted(["opposition_research", "sandbox_x", "sandbox_new"])


def test_only_replaces_existing_entry_and_keeps_rest():
    live = [_entry("opposition_research", version=1), _entry("sandbox_x")]
    new = [_entry("opposition_research", version=9)]
    out = pe._compose_index_entries(
        new, live, only_id="opposition_research", env="dev"
    )
    by_id = {e["id"]: e for e in out}
    assert by_id["opposition_research"]["version"] == 9
    assert "sandbox_x" in by_id
    assert len(out) == 2


def test_only_with_empty_live_index_just_publishes_the_one():
    out = pe._compose_index_entries(
        [_entry("sandbox_new")], [], only_id="sandbox_new", env="dev"
    )
    assert [e["id"] for e in out] == ["sandbox_new"]


def test_dev_full_preserves_sandbox_drops_unknown():
    live = [
        _entry("opposition_research", version=1),
        _entry("sandbox_feliks"),
        _entry("ghost_experiment"),  # unknown, non-sandbox: must NOT be preserved
    ]
    new = [
        _entry("opposition_research", version=2),
        _entry("opportunities_and_challenges"),
    ]
    out = pe._compose_index_entries(new, live, only_id=None, env="dev")
    ids = {e["id"] for e in out}
    assert "sandbox_feliks" in ids  # preserved
    assert "ghost_experiment" not in ids  # dropped
    by_id = {e["id"]: e for e in out}
    assert by_id["opposition_research"]["version"] == 2  # canonical, fresh


def test_dev_full_canonical_wins_on_id_collision():
    # A sandbox id that also exists canonically: canonical wins, no duplicate.
    live = [_entry("sandbox_dup", version=1)]
    new = [_entry("sandbox_dup", version=5)]
    out = pe._compose_index_entries(new, live, only_id=None, env="dev")
    assert len(out) == 1
    assert out[0]["version"] == 5


def test_dev_full_drops_non_sandbox_live_on_collision():
    # A non-sandbox canonical id present in both: canonical (v2) wins, the
    # live v1 is not preserved (non-sandbox live entries never survive a full
    # dev publish), and there is no duplicate.
    live = [_entry("opposition_research", version=1)]
    new = [_entry("opposition_research", version=2)]
    out = pe._compose_index_entries(new, live, only_id=None, env="dev")
    assert len(out) == 1
    assert out[0]["version"] == 2


@pytest.mark.parametrize("env", ["qa", "prod"])
def test_compose_rejects_only_id_outside_dev(env):
    # publish() guards --only at the CLI; the policy function must also refuse,
    # so a future caller can't merge a partial publish into qa/prod.
    with pytest.raises(ValueError, match="dev-only"):
        pe._compose_index_entries(
            [_entry("sandbox_x")], [], only_id="sandbox_x", env=env
        )


@pytest.mark.parametrize("env", ["qa", "prod"])
def test_full_qa_prod_no_preservation(env):
    live = [_entry("sandbox_x"), _entry("opposition_research", version=1)]
    new = [_entry("opposition_research", version=2)]
    out = pe._compose_index_entries(new, live, only_id=None, env=env)
    ids = {e["id"] for e in out}
    assert ids == {"opposition_research"}  # sandbox NOT preserved in qa/prod


def test_compose_output_is_id_sorted_full():
    new = [_entry("zeta"), _entry("alpha")]
    out = pe._compose_index_entries(new, [], only_id=None, env="dev")
    assert [e["id"] for e in out] == ["alpha", "zeta"]


def test_compose_output_is_id_sorted_only():
    # --only concatenates kept + new unsorted, so the final sort is load-bearing
    # specifically on this path.
    live = [_entry("zeta"), _entry("alpha")]
    new = [_entry("middle")]
    out = pe._compose_index_entries(new, live, only_id="middle", env="dev")
    assert [e["id"] for e in out] == ["alpha", "middle", "zeta"]


def test_compose_does_not_mutate_inputs():
    live = [_entry("sandbox_x"), _entry("opposition_research")]
    new = [_entry("opportunities_and_challenges")]
    live_before = [dict(e) for e in live]
    new_before = [dict(e) for e in new]
    pe._compose_index_entries(new, live, only_id=None, env="dev")
    assert live == live_before
    assert new == new_before


def test_only_drops_malformed_carryforward_entry():
    # A drifted live entry whose keys aren't the canonical <id>/... shape is
    # dropped rather than re-published.
    bad = {
        "id": "opposition_research",
        "version": 1,
        "manifest_key": "ATTACKER/manifest.json",
        "instruction_key": "opposition_research/instruction.md",
        "attachment_keys": [],
        "hash": "sha256:bad",
    }
    out = pe._compose_index_entries(
        [_entry("sandbox_new")], [bad], only_id="sandbox_new", env="dev"
    )
    assert [e["id"] for e in out] == ["sandbox_new"]  # bad entry dropped


def test_dev_full_preserves_sandbox_entry_verbatim():
    sb = _entry("sandbox_feliks", version=3)
    out = pe._compose_index_entries(
        [_entry("opposition_research")], [sb], only_id=None, env="dev"
    )
    preserved = next(e for e in out if e["id"] == "sandbox_feliks")
    assert preserved == sb  # carried forward unchanged, not rebuilt


def test_on_drop_callback_fires_with_reason():
    dropped = []
    bad = _entry("sandbox_bad")
    bad["manifest_key"] = "ATTACKER/manifest.json"
    pe._compose_index_entries(
        [_entry("opposition_research")],
        [bad],
        only_id=None,
        env="dev",
        on_drop=lambda e, why: dropped.append((e["id"], why)),
    )
    assert dropped == [("sandbox_bad", "manifest_key is not canonical")]


@pytest.mark.parametrize("only_id", [None, "sandbox_new"])
def test_non_dict_live_entry_dropped_not_crashed(only_id):
    # A corrupt live index whose experiments array holds a string/null must be
    # dropped as drift (and surfaced), not blow up on `.get()`.
    dropped = []
    out = pe._compose_index_entries(
        [_entry("sandbox_new")],
        ["junk", None, _entry("sandbox_keep")],
        only_id=only_id,
        env="dev",
        on_drop=lambda e, why: dropped.append((e, why)),
    )
    assert [e["id"] for e in out] == ["sandbox_keep", "sandbox_new"]
    assert dropped == [("junk", "not a JSON object"), (None, "not a JSON object")]


@pytest.mark.parametrize("only_id", [None, "sandbox_new"])
def test_duplicate_live_ids_deduped_first_wins(only_id):
    # Drifted duplicates in the live index must not be amplified into the
    # fresh index — keep the first, drop and surface the rest.
    dup_a = _entry("sandbox_dupe", version=1)
    dup_b = _entry("sandbox_dupe", version=2)
    dropped = []
    out = pe._compose_index_entries(
        [_entry("sandbox_new")],
        [dup_a, dup_b],
        only_id=only_id,
        env="dev",
        on_drop=lambda e, why: dropped.append((e["version"], why)),
    )
    kept = [e for e in out if e["id"] == "sandbox_dupe"]
    assert len(kept) == 1
    assert kept[0]["version"] == 1  # first wins
    assert dropped == [(2, "duplicate id in live index")]


def test_dev_full_drops_malformed_sandbox_carryforward():
    bad = {
        "id": "sandbox_evil",
        "version": 1,
        "manifest_key": "sandbox_evil/manifest.json",
        "instruction_key": "ATTACKER/instruction.md",  # non-canonical
        "attachment_keys": [],
        "hash": "sha256:bad",
    }
    out = pe._compose_index_entries(
        [_entry("opposition_research")], [bad], only_id=None, env="dev"
    )
    assert [e["id"] for e in out] == ["opposition_research"]  # sandbox bad dropped


def test_invalid_only_id_rejected(capsys):
    rc = pe.publish(env="dev", only="../escape")
    assert rc == 1
    assert "not a valid experiment id" in capsys.readouterr().err


# ---------- publish() guard rails (return before any S3 call) ----------


@pytest.mark.parametrize("env", ["qa", "prod"])
def test_only_rejected_for_qa_prod(env, capsys):
    rc = pe.publish(env=env, only="sandbox_x")
    assert rc == 1
    assert "dev-only" in capsys.readouterr().err


def test_only_unknown_experiment_rejected(capsys):
    rc = pe.publish(env="dev", only="does_not_exist_xyz")
    assert rc == 1
    assert "no experiment dir" in capsys.readouterr().err


def test_invalid_env_rejected(capsys):
    rc = pe.publish(env="staging")
    assert rc == 1
    assert "must be one of" in capsys.readouterr().err


# ---------- _fetch_live_index (Stubber) ----------


def _stubbed_s3():
    s3 = boto3.client("s3", region_name="us-west-2")
    return s3, Stubber(s3)


def _streaming(body: bytes) -> StreamingBody:
    return StreamingBody(io.BytesIO(body), len(body))


def test_fetch_live_index_absent_returns_none():
    s3, stub = _stubbed_s3()
    stub.add_client_error(
        "get_object", service_error_code="NoSuchKey", http_status_code=404
    )
    with stub:
        assert pe._fetch_live_index(s3, "agent-experiment-metadata-dev") is None


def test_fetch_live_index_valid():
    s3, stub = _stubbed_s3()
    body = json.dumps({"experiments": [_entry("opposition_research")]}).encode()
    stub.add_response(
        "get_object",
        {"Body": _streaming(body)},
        {"Bucket": "agent-experiment-metadata-dev", "Key": "index.json"},
    )
    with stub:
        out = pe._fetch_live_index(s3, "agent-experiment-metadata-dev")
    assert out == {"experiments": [_entry("opposition_research")]}


def test_fetch_live_index_access_denied_propagates():
    # A non-absent ClientError (e.g. AccessDenied) must NOT be swallowed as
    # "fresh bucket" — it has to surface so the publish fails loudly.
    s3, stub = _stubbed_s3()
    stub.add_client_error(
        "get_object", service_error_code="AccessDenied", http_status_code=403
    )
    with stub, pytest.raises(ClientError):
        pe._fetch_live_index(s3, "agent-experiment-metadata-dev")


def test_fetch_live_index_nosuchbucket_propagates():
    # A missing bucket is not "fresh index" — it must surface, not return None.
    s3, stub = _stubbed_s3()
    stub.add_client_error(
        "get_object", service_error_code="NoSuchBucket", http_status_code=404
    )
    with stub, pytest.raises(ClientError):
        pe._fetch_live_index(s3, "agent-experiment-metadata-dev")


def test_fetch_live_index_corrupt_json_raises():
    s3, stub = _stubbed_s3()
    stub.add_response(
        "get_object",
        {"Body": _streaming(b"{ not json")},
        {"Bucket": "agent-experiment-metadata-dev", "Key": "index.json"},
    )
    with stub, pytest.raises(RuntimeError, match="not valid JSON"):
        pe._fetch_live_index(s3, "agent-experiment-metadata-dev")


def test_publish_warns_on_dropped_live_entries(hermetic_experiment_tree, monkeypatch, capsys):
    """The on_drop wiring in publish(): a drifted live entry must surface as an
    operator-facing stderr warning, not vanish silently. S3 is stubbed out —
    this exercises the wiring, not the upload path. The experiments tree is the
    hermetic single-experiment fixture, so the full-publish path runs for real
    (validate + build + on-disk reads) without depending on the whole roster."""
    drifted = _entry("sandbox_drifted")
    drifted["manifest_key"] = "ATTACKER/manifest.json"
    uploads: list[str] = []
    monkeypatch.setattr(pe.boto3, "client", lambda *a, **k: object())
    monkeypatch.setattr(
        pe, "_fetch_live_index", lambda s3, bucket: {"experiments": [drifted]}
    )
    monkeypatch.setattr(
        pe, "_upload", lambda s3, bucket, key, body, ct: uploads.append(key)
    )
    # Reclamation (added to publish() by the omni QA-gate work, after this test
    # was first written) would call .list_objects_v2 on the bare object() stub
    # and raise. This test only exercises the on_drop warning + index-last
    # ordering, so stub reclaim out.
    monkeypatch.setattr(pe, "_reclaim_orphans", lambda *a, **k: None)
    rc = pe.publish(env="dev")
    err = capsys.readouterr().err
    assert rc == 0
    assert "dropped 1 malformed live index entr" in err
    assert "sandbox_drifted (manifest_key is not canonical)" in err
    assert uploads[-1] == "index.json"  # atomic switch still written last


def test_fetch_live_index_missing_experiments_array_raises():
    s3, stub = _stubbed_s3()
    stub.add_response(
        "get_object",
        {"Body": _streaming(json.dumps({"published_at": "now"}).encode())},
        {"Bucket": "agent-experiment-metadata-dev", "Key": "index.json"},
    )
    with stub, pytest.raises(RuntimeError, match="experiments"):
        pe._fetch_live_index(s3, "agent-experiment-metadata-dev")


def test_only_publish_uploads_files_and_writes_index_last(
    hermetic_experiment_tree, monkeypatch
):
    """The --only upload leg: publish(only=<id>) must upload that experiment's
    manifest + instruction and still write index.json LAST. Exercises the
    ThreadPoolExecutor block + merged-index write that the guard-rail and pure
    _compose_index_entries tests never reach. Live index carries an unrelated
    sandbox entry so the merge (kept + new) is real, not a no-op."""
    exp_name = next(
        p.name
        for p in sorted(hermetic_experiment_tree.iterdir())
        if (hermetic_experiment_tree / p.name / "manifest.json").exists()
        and not p.name.startswith((".", "_"))
    )
    uploads: list[str] = []
    monkeypatch.setattr(pe.boto3, "client", lambda *a, **k: object())
    monkeypatch.setattr(
        pe, "_fetch_live_index",
        lambda s3, bucket: {"experiments": [_entry("sandbox_other")]},
    )
    monkeypatch.setattr(
        pe, "_upload", lambda s3, bucket, key, body, ct: uploads.append(key)
    )
    monkeypatch.setattr(pe, "_reclaim_orphans", lambda *a, **k: None)
    rc = pe.publish(env="dev", only=exp_name)
    assert rc == 0
    assert f"{exp_name}/manifest.json" in uploads
    assert f"{exp_name}/instruction.md" in uploads
    assert uploads[-1] == "index.json"  # atomic switch written last
