"""Ticket Test Plan: "IAM: confirm from the Terraform diff that the new
grant is read-only on the judge records bucket." A text check rather than a
`terraform plan` run (this suite has no AWS credentials and no state) — it
reads the same module file a reviewer would, so a future edit that widens
the grant to a write action fails loudly here instead of only in review."""

from pathlib import Path

MAIN_TF = Path(__file__).resolve().parent.parent.parent / "infrastructure/modules/case-scout/main.tf"


class TestJudgeRecordsGrantIsReadOnly:
    def test_the_grant_exists_and_names_the_records_prefix(self):
        text = MAIN_TF.read_text()

        assert "judge-records-readonly" in text
        assert "_judge/*/records/*" in text

    def test_the_grant_never_includes_a_write_action(self):
        text = MAIN_TF.read_text()
        start = text.index('name = "judge-records-readonly"')
        # The policy's own closing brace, found by the next top-level
        # resource block starting after this one.
        end = text.index('\nresource "aws_iam_role_policy" "reader_task_secrets"', start)
        grant_block = text[start:end]

        for write_action in ("s3:PutObject", "s3:DeleteObject", "s3:PutObjectAcl"):
            assert write_action not in grant_block

    def test_the_grant_never_touches_manifests_or_rulings(self):
        text = MAIN_TF.read_text()
        start = text.index('name = "judge-records-readonly"')
        end = text.index('\nresource "aws_iam_role_policy" "reader_task_secrets"', start)
        grant_block = text[start:end]

        assert "manifests" not in grant_block
        assert "rulings" not in grant_block
