from case_scout import dispatch


class _FakeEcsClient:
    def __init__(self, response=None, raises=None):
        self._response = response or {"tasks": [{"taskArn": "arn:aws:ecs:fake:task/1"}], "failures": []}
        self._raises = raises
        self.calls = []

    def run_task(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises:
            raise self._raises
        return self._response


class TestLaunchReaderTask:
    def _set_env(self, monkeypatch):
        monkeypatch.setenv("ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:111111111111:cluster/case-scout-reader-dev")
        monkeypatch.setenv("ECS_TASK_DEFINITION", "case-scout-reader-dev")
        monkeypatch.setenv("SUBNET_IDS", "subnet-a,subnet-b")
        monkeypatch.setenv("SECURITY_GROUP_ID", "sg-1")

    def test_refuses_to_launch_with_incomplete_config(self, monkeypatch):
        result = dispatch.launch_reader_task("2026-11-05")

        assert result == {"launched": False, "error": "ECS configuration is missing or incomplete; refusing to launch the Reader"}

    def test_launches_with_the_expected_shape(self, monkeypatch):
        self._set_env(monkeypatch)
        fake = _FakeEcsClient()
        monkeypatch.setattr(dispatch, "_ecs", lambda: fake)

        result = dispatch.launch_reader_task("2026-11-05")

        assert result == {"launched": True, "task_arn": "arn:aws:ecs:fake:task/1"}
        call = fake.calls[0]
        assert call["cluster"] == "arn:aws:ecs:us-west-2:111111111111:cluster/case-scout-reader-dev"
        assert call["taskDefinition"] == "case-scout-reader-dev"
        assert call["launchType"] == "FARGATE"
        assert call["networkConfiguration"]["awsvpcConfiguration"]["subnets"] == ["subnet-a", "subnet-b"]
        assert call["networkConfiguration"]["awsvpcConfiguration"]["securityGroups"] == ["sg-1"]
        assert call["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"] == "DISABLED"
        override = call["overrides"]["containerOverrides"][0]
        assert override["name"] == "case-scout-reader"
        assert {"name": "CASE_SCOUT_RUN_DATE", "value": "2026-11-05"} in override["environment"]

    def test_reports_ecs_failures_without_raising(self, monkeypatch):
        self._set_env(monkeypatch)
        fake = _FakeEcsClient(response={"tasks": [], "failures": [{"reason": "RESOURCE:FARGATE"}]})
        monkeypatch.setattr(dispatch, "_ecs", lambda: fake)

        result = dispatch.launch_reader_task("2026-11-05")

        assert result == {"launched": False, "error": "ECS task launch failed"}

    def test_reports_an_exception_without_raising(self, monkeypatch):
        self._set_env(monkeypatch)
        fake = _FakeEcsClient(raises=RuntimeError("boom"))
        monkeypatch.setattr(dispatch, "_ecs", lambda: fake)

        result = dispatch.launch_reader_task("2026-11-05")

        assert result == {"launched": False, "error": "ECS run_task failed"}
