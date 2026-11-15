"""The Reader resolves its Databricks credentials through ai_secrets.secret(),
which returns "" for every key when AI_SECRETS_NAME is unset. The Lambda had
the variable and the Reader's task definition did not, so the first real night
would have failed with "missing CASE_SCOUT_DATABRICKS_..." even after the
secret was written. A text check on the module, same approach as
test_judge_records_iam.py, because this suite has no Terraform state."""

from pathlib import Path

MAIN_TF = Path(__file__).resolve().parent.parent.parent / "infrastructure/modules/case-scout/main.tf"


def reader_task_definition() -> str:
    text = MAIN_TF.read_text()
    start = text.index('resource "aws_ecs_task_definition" "reader"')
    end = text.index('\nresource "', start + 1)
    return text[start:end]


class TestReaderTaskEnvironment:
    def test_the_reader_names_its_secrets_bundle(self):
        block = reader_task_definition()

        assert 'name  = "AI_SECRETS_NAME"' in block
        assert 'value = "AI_SECRETS_${upper(var.environment)}"' in block

    def test_the_databricks_credentials_are_not_injected_at_task_start(self):
        # A valueFrom on a key that is not written yet stops ECS from starting
        # the task at all, which hides the scout's own clear "missing ..." error.
        block = reader_task_definition()

        assert ":CASE_SCOUT_DATABRICKS_" not in block
