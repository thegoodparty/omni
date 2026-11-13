import json

from case_scout import alerts


class _FakeSnsClient:
    def __init__(self, raises=None):
        self._raises = raises
        self.published = []

    def publish(self, **kwargs):
        if self._raises:
            raise self._raises
        self.published.append(kwargs)


class TestPostAlert:
    def test_drops_the_alert_when_unconfigured(self, monkeypatch, capsys):
        monkeypatch.delenv("CASE_SCOUT_ALERTS_TOPIC_ARN", raising=False)

        result = alerts.post_alert("dev", "subject", "message")

        assert result is False
        assert "not configured" in capsys.readouterr().out

    def test_publishes_with_the_expected_shape(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_ALERTS_TOPIC_ARN", "arn:aws:sns:us-west-2:111111111111:case-scout-failures")
        fake = _FakeSnsClient()
        monkeypatch.setattr(alerts, "_sns", lambda: fake)

        result = alerts.post_alert("dev", "case scout spend cap hit", "runDate=2026-11-05")

        assert result is True
        call = fake.published[0]
        assert call["TopicArn"] == "arn:aws:sns:us-west-2:111111111111:case-scout-failures"
        body = json.loads(call["Message"])
        assert body == {"alarm": "case scout spend cap hit", "environment": "dev", "detail": "runDate=2026-11-05"}

    def test_never_raises_on_publish_failure(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_ALERTS_TOPIC_ARN", "arn:aws:sns:us-west-2:111111111111:case-scout-failures")
        monkeypatch.setattr(alerts, "_sns", lambda: _FakeSnsClient(raises=RuntimeError("boom")))

        result = alerts.post_alert("dev", "subject", "message")

        assert result is False
