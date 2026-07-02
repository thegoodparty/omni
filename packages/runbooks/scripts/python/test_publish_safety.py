"""Publish safety contracts:

1. `_validate_attachments` guard clauses — symlinks (arbitrary-file-read vector),
   nested dirs, the reserved `output/` prefix, non-UTF-8 bodies, and the total
   size cap. Each must fail loudly BEFORE any S3 write.
2. The atomic switch — index.json is written LAST, and a failed per-file upload
   must block the index write entirely (readers never see a partial publish).
3. Dry-run never touches S3.
"""
import shutil
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

import publish_experiments as pub
from publish_experiments import AttachmentValidationError, _validate_attachments


def _exp(tmp_path: Path) -> Path:
    d = tmp_path / "some_exp" / "attachments"
    d.mkdir(parents=True)
    return tmp_path / "some_exp"


def test_flat_utf8_attachments_returned_sorted_with_bodies(tmp_path):
    exp = _exp(tmp_path)
    (exp / "attachments" / "b.py").write_text("print('b')")
    (exp / "attachments" / "a.md").write_text("# a")
    out = _validate_attachments(exp)
    assert out == [("a.md", b"# a"), ("b.py", b"print('b')")]


def test_symlink_attachment_is_rejected(tmp_path):
    exp = _exp(tmp_path)
    secret = tmp_path / "secret.txt"
    secret.write_text("creds")
    (exp / "attachments" / "innocent.txt").symlink_to(secret)
    with pytest.raises(AttachmentValidationError, match="symlink"):
        _validate_attachments(exp)


def test_nested_subdirectory_attachment_is_rejected(tmp_path):
    exp = _exp(tmp_path)
    (exp / "attachments" / "sub").mkdir()
    (exp / "attachments" / "sub" / "f.txt").write_text("x")
    with pytest.raises(AttachmentValidationError, match="nested"):
        _validate_attachments(exp)


def test_reserved_output_prefix_is_rejected_even_before_nested_rule(tmp_path):
    exp = _exp(tmp_path)
    (exp / "attachments" / "output").mkdir()
    (exp / "attachments" / "output" / "f.json").write_text("{}")
    with pytest.raises(AttachmentValidationError, match="output/"):
        _validate_attachments(exp)


def test_non_utf8_attachment_is_rejected(tmp_path):
    exp = _exp(tmp_path)
    (exp / "attachments" / "blob.bin").write_bytes(b"\xff\xfe\x00binary")
    with pytest.raises(AttachmentValidationError, match="UTF-8"):
        _validate_attachments(exp)


def test_total_size_cap_enforced(tmp_path, monkeypatch):
    exp = _exp(tmp_path)
    monkeypatch.setattr(pub, "ATTACHMENTS_TOTAL_SIZE_LIMIT_BYTES", 10)
    (exp / "attachments" / "big.txt").write_text("x" * 11)
    with pytest.raises(AttachmentValidationError, match="exceeds cap"):
        _validate_attachments(exp)


# --- the atomic switch: index.json LAST, and never after a failed upload ---

class _RecordingS3:
    """Stands in for boto3 s3 client; records put_object keys in call order.

    Also answers get_object with NoSuchKey ("no live index yet") so these tests
    keep working against a publisher that fetches the live index before writing
    (the develop publisher never calls it; PR #87's merge-aware one does)."""

    def __init__(self, fail_on_key_prefix=None):
        self.keys = []
        self.deleted = []
        self.fail_on_key_prefix = fail_on_key_prefix

    def put_object(self, Bucket, Key, Body, ContentType):
        if self.fail_on_key_prefix and Key.startswith(self.fail_on_key_prefix):
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject")
        self.keys.append(Key)

    def get_object(self, Bucket, Key):
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")

    def list_objects_v2(self, Bucket, Prefix):
        live = [k for k in self.keys if k.startswith(Prefix) and k not in self.deleted]
        return {"Contents": [{"Key": k} for k in live]}

    def delete_objects(self, Bucket, Delete):
        self.deleted.extend(o["Key"] for o in Delete["Objects"])


@pytest.fixture
def real_experiment_tree(tmp_path, monkeypatch):
    """A minimal real experiments tree: the actual meta-schema + one actual experiment,
    so publish() exercises real validation without the full roster."""
    root = tmp_path / "experiments"
    root.mkdir()
    shutil.copytree(pub.EXPERIMENTS_DIR / "_schema", root / "_schema")
    src = sorted(
        p for p in pub.EXPERIMENTS_DIR.iterdir()
        if p.is_dir() and (p / "manifest.json").exists() and not p.name.startswith((".", "_"))
    )[0]
    shutil.copytree(src, root / src.name)
    monkeypatch.setattr(pub, "EXPERIMENTS_DIR", root)
    monkeypatch.setattr(pub, "META_SCHEMA_PATH", root / "_schema" / "manifest.schema.json")
    return root


def test_index_json_is_written_last_exactly_once(real_experiment_tree, monkeypatch):
    s3 = _RecordingS3()
    monkeypatch.setattr(pub.boto3, "client", lambda *_a, **_k: s3)
    rc = pub.publish("dev")
    assert rc == 0
    assert s3.keys.count("index.json") == 1
    assert s3.keys[-1] == "index.json"
    assert len(s3.keys) > 1  # per-experiment files really preceded it


def test_reclaim_deletes_stale_attachment_orphans(real_experiment_tree, monkeypatch):
    exp_id = sorted(p.name for p in real_experiment_tree.iterdir() if p.name != "_schema")[0]
    s3 = _RecordingS3()
    orphan = f"{exp_id}/attachments/removed-long-ago.txt"
    s3.keys.append(orphan)  # pre-existing S3 object no longer emitted by this publish
    monkeypatch.setattr(pub.boto3, "client", lambda *_a, **_k: s3)
    rc = pub.publish("dev")
    assert rc == 0
    assert s3.deleted == [orphan]  # the orphan and ONLY the orphan is reclaimed


def test_reclaim_list_failure_degrades_to_warning(real_experiment_tree, monkeypatch, capsys):
    class _ListDenied(_RecordingS3):
        def list_objects_v2(self, Bucket, Prefix):
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "ListObjectsV2")
    s3 = _ListDenied()
    monkeypatch.setattr(pub.boto3, "client", lambda *_a, **_k: s3)
    rc = pub.publish("dev")
    assert rc == 0  # a missing list permission must never fail the publish
    assert s3.keys.count("index.json") == 1  # the atomic switch still happened
    assert "could not reclaim orphans" in capsys.readouterr().err


def test_failed_upload_blocks_the_index_write(real_experiment_tree, monkeypatch):
    exp_id = sorted(p.name for p in real_experiment_tree.iterdir() if p.name != "_schema")[0]
    s3 = _RecordingS3(fail_on_key_prefix=f"{exp_id}/")
    monkeypatch.setattr(pub.boto3, "client", lambda *_a, **_k: s3)
    with pytest.raises(ClientError):
        pub.publish("dev")
    assert "index.json" not in s3.keys  # partial publish never becomes visible


def test_dry_run_makes_no_s3_writes(real_experiment_tree, monkeypatch):
    s3 = _RecordingS3()
    monkeypatch.setattr(pub.boto3, "client", lambda *_a, **_k: s3)
    rc = pub.publish("dev", dry_run=True)
    assert rc == 0
    assert s3.keys == []
