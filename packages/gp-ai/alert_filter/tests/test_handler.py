import base64
import json

# Loaded by path in conftest.py under this name, not as `handler`. Both Lambdas
# in this repo ship a `handler.py`, and the bare name cannot belong to either
# suite without breaking the other — see conftest.py.
import alert_filter_handler as h
import pytest

SECRET = "a-shared-secret"
MENTION = "<!subteam^S0AE3NTCXM3>"

RAW = "C_RAW"
FILTERED = "C_FILTERED"
URGENT_CHANNEL = "C_URGENT"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("RAW_CHANNEL_ID", RAW)
    monkeypatch.setenv("FILTERED_CHANNEL_ID", FILTERED)
    monkeypatch.setenv("URGENT_CHANNEL_ID", URGENT_CHANNEL)
    monkeypatch.setenv("ALERT_FILTER_MODE", "enforce")
    # The pure modules' credentials, so `_hydrate_environment` finds them in the
    # environment and never reaches for the bundle. The `no_aws` fixture turns
    # forgetting one into an immediate failure rather than a slow pass.
    monkeypatch.setenv("LOKI_TOKEN", "loki-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("DEDUP_TABLE_NAME", raising=False)
    return monkeypatch


@pytest.fixture
def slack(monkeypatch):
    """Captures every post, keyed nowhere: order matters in several tests."""
    posts = []

    def post(channel, text, thread_ts=None):
        posts.append({"channel": channel, "text": text, "thread_ts": thread_ts})
        return f"ts-{len(posts)}"

    monkeypatch.setattr(h, "_post", post)
    return posts


@pytest.fixture
def no_network(monkeypatch):
    """Neither Loki nor Anthropic is reachable from a test, by construction."""
    monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, []))
    monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, [], 0.0001))


def request(payload, *, secret=SECRET, b64=False):
    body = json.dumps(payload)
    return {
        "headers": {"authorization": "Basic " + base64.b64encode(f"grafana:{secret}".encode()).decode()},
        "body": base64.b64encode(body.encode()).decode() if b64 else body,
        "isBase64Encoded": b64,
    }


def only(posts, channel):
    return [p for p in posts if p["channel"] == channel]


class TestNothingIsEverHiddenFromEverybody:
    # Invariant 1. Asserted for the outcome that hides the alert from the
    # filtered channel, because that is the only one where the guarantee can be
    # broken by a mistake rather than by intent.
    def test_a_suppressed_alert_still_reaches_the_raw_channel(self, env, slack, monkeypatch, webhook):
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))

        assert only(slack, RAW)
        assert not [p for p in only(slack, FILTERED) if p["thread_ts"] is None]

    # The raw post is made before the decision is acted on, so invariant 1
    # holds even when everything after it fails.
    def test_the_raw_post_happens_before_anything_can_fail(self, env, slack, monkeypatch, webhook):
        def explode(*_, **__):
            raise RuntimeError("classifier blew up in a way nobody predicted")

        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, []))
        monkeypatch.setattr(h.classifier, "classify_alert", explode)

        h.handler(request(webhook()))

        assert slack[0]["channel"] == RAW

    # The last-resort path. An alert that arrives looking normal after the
    # filter crashed would misrepresent how much to trust the rest of the
    # channel, so it says so.
    def test_an_unexpected_exception_posts_the_alert_unfiltered_and_admits_it(self, env, slack, monkeypatch, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: 1 / 0)

        result = h.handler(request(webhook()))

        fallback = [p for p in only(slack, FILTERED) if "could not process" in p["text"]]
        assert fallback
        assert result["statusCode"] == 200

    # A grouped delivery carries several alerts, and dropping four because the
    # first hit an unexpected shape is the worst outcome available here.
    def test_one_alerts_failure_does_not_discard_the_others(self, env, slack, monkeypatch, webhook):
        seen = []

        def gather(causes, **_):
            seen.append(causes)
            if len(seen) == 1:
                raise RuntimeError("only the first one")
            return {}, []

        monkeypatch.setattr(h.evidence, "gather", gather)
        monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, [], None))
        one = webhook()["alerts"][0]

        h.handler(request(webhook(alerts=[one, {**one, "fingerprint": "second"}])))

        assert len(seen) == 2
        assert any("could not process" in p["text"] for p in slack)


class TestUncertaintyNotifies:
    # Invariant 2, through the real classify path rather than a stubbed
    # decision: a Loki failure has to reach the channel as a notification.
    def test_an_unreachable_loki_notifies_with_a_note(self, env, slack, monkeypatch, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, ["loki unreachable"]))
        monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, [], None))

        h.handler(request(webhook()))

        posted = [p for p in only(slack, FILTERED) if "could not fully check" in p["text"]]
        assert posted
        assert "loki unreachable" in posted[0]["text"]

    def test_an_unreachable_classifier_notifies(self, env, slack, monkeypatch, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, []))
        monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, ["model down"], None))

        h.handler(request(webhook()))

        assert any("could not fully check" in p["text"] for p in only(slack, FILTERED))

    # A firing delivery the parser found no alerts in means every alert in it
    # has just been dropped, so it is an error even though there is nothing to
    # post — distinct from a resolved delivery, which is the system working.
    def test_an_unparseable_firing_delivery_is_loud_but_a_resolved_one_is_not(self, env, slack, capsys, webhook):
        h.handler(request({"status": "firing", "alerts": "not a list"}))
        assert "ERROR" in capsys.readouterr().out

        h.handler(request(webhook(status="resolved")))
        assert "ERROR" not in capsys.readouterr().out
        assert slack == []


class TestARedeliveryIsNotASecondAlert:
    # Invariant 3. Grafana retries a delivery it did not get a 2xx for, with the
    # same fingerprints — so without this a slow Loki query turns one alert into
    # three posts and three model calls.
    def test_a_replayed_delivery_is_handled_once(self, env, no_network, slack, monkeypatch, webhook):
        claimed = set()

        def claim(alert):
            key = alert["fingerprint"]
            if key in claimed:
                return False
            claimed.add(key)
            return True

        monkeypatch.setattr(h, "_claim", claim)

        h.handler(request(webhook()))
        first = len(slack)
        h.handler(request(webhook()))

        assert len(slack) == first

    # Keyed on the fingerprint AND `startsAt`, because the fingerprint
    # identifies the label set and is stable across firings — on its own it
    # would suppress the second time an alert fired for real.
    def test_the_same_alert_firing_again_later_is_a_new_alert(self, env, monkeypatch, webhook):
        keys = []
        monkeypatch.setenv("DEDUP_TABLE_NAME", "t")
        monkeypatch.setattr(
            h,
            "_dynamodb_client",
            lambda: type("C", (), {"put_item": lambda _self, **kw: keys.append(kw["Item"]["pk"]["S"])})(),
        )

        one = h.payload.firings(webhook())[0]
        h._claim(one)
        h._claim({**one, "started_at": "2026-09-14T18:00:00Z"})

        assert len(set(keys)) == 2

    # A broken table costs a duplicate post; a table that fails closed costs
    # every alert in #dev-alerts.
    def test_a_broken_dedup_table_fails_open(self, env, monkeypatch, webhook):
        monkeypatch.setenv("DEDUP_TABLE_NAME", "t")

        def broken():
            raise RuntimeError("dynamo is down")

        monkeypatch.setattr(h, "_dynamodb_client", broken)

        assert h._claim(h.payload.firings(webhook())[0]) is True

    # It cannot be deduped, and refusing to handle it would be choosing to drop
    # it.
    def test_a_firing_with_no_fingerprint_is_still_handled(self, env, monkeypatch, webhook):
        monkeypatch.setenv("DEDUP_TABLE_NAME", "t")

        assert h._claim({"fingerprint": None}) is True


class TestTheStatusCodeGrafanaSees:
    # Invariant 4: a 5xx asks Grafana to redeliver, and a redelivery after a
    # successful post is a duplicate in a channel people are being asked to
    # trust.
    @pytest.mark.parametrize(
        "body",
        [
            {"status": "firing", "alerts": "not a list"},
            {"status": "resolved"},
            "not an object at all",
        ],
        ids=["unparseable", "resolved", "garbage"],
    )
    def test_every_failure_still_answers_200(self, env, slack, no_network, body):
        assert h.handler(request(body))["statusCode"] == 200

    def test_an_unreadable_body_answers_200(self, env):
        event = request({})
        event["body"] = "{not json"

        assert h.handler(event)["statusCode"] == 200

    # The one 4xx. A wrong secret is not a delivery to retry, and saying so
    # plainly beats letting a misconfigured contact point look like a filter
    # that has stopped working.
    def test_a_wrong_secret_is_rejected(self, env, slack, webhook):
        result = h.handler(request(webhook(), secret="not-the-secret"))

        assert result["statusCode"] == 401
        assert slack == []

    # Every other failure in the handler fails open. This is the one that must
    # not: an open endpoint here lets anyone post arbitrary text into an
    # engineering Slack channel.
    def test_with_no_secret_configured_nothing_is_accepted(self, monkeypatch, slack, webhook):
        monkeypatch.delenv("WEBHOOK_SECRET", raising=False)

        assert h.handler(request(webhook()))["statusCode"] == 401
        assert slack == []

    @pytest.mark.parametrize(
        "header",
        ["", "Bearer abc", "Basic !!!not-base64!!!", "Basic " + base64.b64encode(b"nocolon").decode()],
        ids=["absent", "wrong-scheme", "bad-base64", "no-colon"],
    )
    def test_a_malformed_authorization_header_is_rejected(self, env, header, webhook):
        event = request(webhook())
        event["headers"] = {"authorization": header}

        assert h.handler(event)["statusCode"] == 401

    def test_it_reads_a_base64_encoded_alb_body(self, env, slack, no_network, webhook):
        result = h.handler(request(webhook(), b64=True))

        assert json.loads(result["body"])["handled"] == 1


class TestShadowModeChangesNothingVisible:
    # How this ships. The filtered channel keeps behaving exactly as it does
    # today, so the suppress list can be reviewed against a week of real
    # firings before anything starts being hidden.
    def test_a_suppression_is_still_posted_to_the_filtered_channel(self, env, slack, monkeypatch, webhook):
        monkeypatch.setenv("ALERT_FILTER_MODE", "shadow")
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))

        top_level = [p for p in only(slack, FILTERED) if p["thread_ts"] is None]
        assert len(top_level) == 1
        assert MENTION in top_level[0]["text"]

    # The link is the other half of "behaves exactly as it does today": it rides
    # on the notification rather than in the description annotation, so posting
    # the body alone would take the one clickable thing out of every alert in
    # #dev-alerts for the whole shadow period.
    def test_the_filtered_post_still_carries_the_grafana_link(self, env, slack, monkeypatch, webhook):
        monkeypatch.setenv("ALERT_FILTER_MODE", "shadow")
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))

        top_level = [p for p in only(slack, FILTERED) if p["thread_ts"] is None]
        assert "View in Grafana" in top_level[0]["text"]

    # Without this, "would this have suppressed something it should not have"
    # is unanswerable except by turning it on and finding out.
    def test_the_decision_is_still_recorded_in_the_thread_and_the_metric(
        self, env, slack, monkeypatch, capsys, webhook
    ):
        monkeypatch.setenv("ALERT_FILTER_MODE", "shadow")
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))

        threaded = [p for p in only(slack, RAW) if p["thread_ts"]]
        assert threaded and "suppressed" in threaded[0]["text"]

        out = capsys.readouterr().out
        assert "GPALERT_METRIC" in out
        assert '"outcome": "suppress"' in out
        assert "SHADOW: would have suppressed" in out

    def test_shadow_mode_never_mirrors_to_the_urgent_channel(self, env, slack, monkeypatch, webhook):
        monkeypatch.setenv("ALERT_FILTER_MODE", "shadow")
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, []))
        monkeypatch.setattr(
            h.classifier,
            "classify_alert",
            lambda *a, **k: ({}, {"urgent": True, "reason": "prod is down"}, [], None),
        )

        h.handler(request(webhook()))

        assert only(slack, URGENT_CHANNEL) == []

    # An unrecognised mode is a misconfiguration, and the safe reading of a
    # misconfiguration is "change nothing".
    @pytest.mark.parametrize("configured", ["", "on", "true", "ENFORCED", "shadow", None])
    def test_anything_but_enforce_is_shadow(self, monkeypatch, configured):
        if configured is None:
            monkeypatch.delenv("ALERT_FILTER_MODE", raising=False)
        else:
            monkeypatch.setenv("ALERT_FILTER_MODE", configured)

        assert h.mode() == "shadow"

    @pytest.mark.parametrize("configured", ["enforce", "ENFORCE", " Enforce "])
    def test_enforce_is_recognised_however_it_is_written(self, monkeypatch, configured):
        monkeypatch.setenv("ALERT_FILTER_MODE", configured)

        assert h.mode() == "enforce"


class TestWhatEnforceModeDoes:
    def test_an_urgent_alert_pings_and_mirrors(self, env, slack, monkeypatch, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, []))
        monkeypatch.setattr(
            h.classifier,
            "classify_alert",
            lambda *a, **k: ({}, {"urgent": True, "reason": "error rate 40%"}, [], None),
        )

        h.handler(request(webhook()))

        filtered = [p for p in only(slack, FILTERED) if p["thread_ts"] is None][0]
        assert MENTION in filtered["text"]
        assert only(slack, URGENT_CHANNEL)

    def test_a_routine_alert_is_posted_without_a_ping(self, env, slack, no_network, webhook):
        h.handler(request(webhook()))

        filtered = [p for p in only(slack, FILTERED) if p["thread_ts"] is None][0]
        assert MENTION not in filtered["text"]
        assert only(slack, URGENT_CHANNEL) == []

    def test_a_suppressed_alert_is_not_posted_to_the_filtered_channel(self, env, slack, monkeypatch, webhook):
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))

        assert [p for p in only(slack, FILTERED) if p["thread_ts"] is None] == []


class TestTheMetricRecordsTheDecisionNotThePosting:
    # In shadow mode those differ by design, and a metric that reported the
    # posting would make a week of shadow data indistinguishable from a week
    # with no filter at all.
    def test_it_records_what_the_filter_decided(self, env, slack, monkeypatch, capsys, webhook):
        monkeypatch.setenv("ALERT_FILTER_MODE", "shadow")
        _confirm_the_known_cause(monkeypatch)

        h.handler(request(webhook()))
        line = _metric_line(capsys.readouterr().out)

        assert line["outcome"] == "suppress"
        assert line["cause_id"] == "people-db-statement-timeout"
        assert line["slug"] == "door-knocking-pack-build-failed"

    def test_it_records_the_cost_and_the_query_count(self, env, slack, monkeypatch, capsys, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({"people-db-statement-timeout": {"lines": []}}, []))
        monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, [], 0.000123))

        h.handler(request(webhook()))
        line = _metric_line(capsys.readouterr().out)

        assert line["cost_usd"] == pytest.approx(0.000123)
        assert line["evidence_queries"] == 1

    # A week of NOTIFY decisions means one thing if the filter chose them and
    # something entirely different if it spent the week unable to reach Loki.
    def test_a_degraded_decision_is_marked_as_one(self, env, slack, monkeypatch, capsys, webhook):
        monkeypatch.setattr(h.evidence, "gather", lambda *a, **k: ({}, ["loki down"]))
        monkeypatch.setattr(h.classifier, "classify_alert", lambda *a, **k: ({}, {}, [], None))

        h.handler(request(webhook()))
        line = _metric_line(capsys.readouterr().out)

        assert line["degraded"] is True
        assert line["outcome"] == "notify"

    # The metric is written after everything a human can see, because failing
    # to record a decision is much cheaper than failing to deliver one.
    def test_a_metric_is_emitted_for_every_alert_in_a_group(self, env, slack, no_network, capsys, webhook):
        one = webhook()["alerts"][0]

        h.handler(request(webhook(alerts=[one, {**one, "fingerprint": "second"}])))

        assert capsys.readouterr().out.count("GPALERT_METRIC") == 2


class TestPostingToSlack:
    # Every caller is mid-sequence and its later steps still matter: a failed
    # raw post must not stop the filtered post, and a failed thread reply must
    # not stop the metric.
    def test_a_failed_post_is_reported_as_none_rather_than_raised(self, env, monkeypatch, capsys):
        def boom(*_, **__):
            raise OSError("connection reset")

        monkeypatch.setattr(h, "urlopen", boom)

        assert h._post(RAW, "text") is None
        assert "ERROR" in capsys.readouterr().out

    # `not_in_channel` and `channel_not_found` are the two setup mistakes this
    # will actually hit, and both are invisible without the log line.
    def test_slacks_own_error_is_logged(self, env, monkeypatch, capsys):
        monkeypatch.setattr(h, "urlopen", _fake_slack({"ok": False, "error": "not_in_channel"}))

        assert h._post(RAW, "text") is None
        assert "not_in_channel" in capsys.readouterr().out

    def test_a_missing_channel_or_token_is_loud_rather_than_silent(self, env, monkeypatch, capsys):
        monkeypatch.delenv("SLACK_BOT_TOKEN")

        assert h._post(RAW, "text") is None
        assert "no bot token" in capsys.readouterr().out

    def test_the_thread_reply_is_posted_under_the_raw_message(self, env, slack, no_network, webhook):
        h.handler(request(webhook()))

        threaded = [p for p in only(slack, RAW) if p["thread_ts"]]
        assert threaded and threaded[0]["thread_ts"] == "ts-1"

    def test_a_raw_post_that_failed_does_not_produce_an_orphan_thread_reply(
        self, env, monkeypatch, no_network, webhook
    ):
        posts = []

        def post(channel, text, thread_ts=None):
            posts.append({"channel": channel, "thread_ts": thread_ts})
            return None if channel == RAW else "ts"

        monkeypatch.setattr(h, "_post", post)

        h.handler(request(webhook()))

        assert [p for p in posts if p["thread_ts"]] == []


def _confirm_the_known_cause(monkeypatch):
    monkeypatch.setattr(
        h.evidence,
        "gather",
        lambda *a, **k: ({"people-db-statement-timeout": {"query": "q", "lines": ["Code: 57014"]}}, []),
    )
    monkeypatch.setattr(
        h.classifier,
        "classify_alert",
        lambda *a, **k: (
            {"people-db-statement-timeout": {"state": "confirmed", "reason": "every line has 57014"}},
            {"urgent": False, "reason": ""},
            [],
            0.0002,
        ),
    )


def _metric_line(output):
    for line in output.splitlines():
        _, marker, body = line.partition("GPALERT_METRIC ")
        if marker:
            return json.loads(body)
    raise AssertionError(f"no metric line in output: {output}")


def _fake_slack(response):
    class Fake:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps(response).encode()

    return lambda *a, **k: Fake()


class TestWhereCredentialsComeFrom:
    # The point of the bundle: none of the four credentials appear in the
    # function's environment, where `get-function-configuration` shows them to
    # anyone with Lambda read access, nor in Terraform state.
    def test_a_credential_is_read_from_the_bundle_when_the_environment_lacks_it(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.setattr(h, "_secrets", {"SLACK_BOT_TOKEN": "xoxb-from-the-bundle"})

        assert h.secret("SLACK_BOT_TOKEN") == "xoxb-from-the-bundle"

    # Environment first, and the order is about testability rather than
    # precedence — it is what lets this whole suite run with no AWS.
    def test_the_environment_wins_when_it_is_set(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-from-the-environment")
        monkeypatch.setattr(h, "_secrets", {"SLACK_BOT_TOKEN": "xoxb-from-the-bundle"})

        assert h.secret("SLACK_BOT_TOKEN") == "xoxb-from-the-environment"

    # Every caller already handles an absent credential: no Loki token degrades
    # the decision to notify, no webhook secret rejects the delivery. Raising
    # would surface as a Lambda error, which Grafana retries — and a retry
    # cannot fix a missing secret, so it would only multiply the failure.
    def test_an_unreachable_secrets_manager_returns_empty_rather_than_raising(self, monkeypatch, capsys):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)

        def broken(*_, **__):
            raise RuntimeError("secretsmanager is down")

        monkeypatch.setattr(h.boto3, "client", broken)

        assert h.secret("SLACK_BOT_TOKEN") == ""
        assert "ERROR" in capsys.readouterr().out

    # A blip during one invocation must not poison the container for the rest of
    # its life, which a cached failure would.
    def test_a_failed_fetch_is_not_cached(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.setattr(h, "_secrets", None)
        monkeypatch.setattr(h.boto3, "client", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))

        h.secret("SLACK_BOT_TOKEN")

        assert h._secrets is None

    # An unauthenticated request must not be able to make this function fetch
    # secrets: it is the one operation here that costs money per call and can be
    # rate-limited, so it is the one an open endpoint could be used to exhaust.
    def test_an_unauthenticated_request_never_triggers_a_secrets_fetch(self, env, slack, webhook, monkeypatch):
        monkeypatch.delenv("LOKI_TOKEN", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        # `no_aws` already makes any boto3 call raise, so a fetch here would
        # fail the test rather than merely be observed.

        assert h.handler(request(webhook(), secret="wrong"))["statusCode"] == 401

    def test_the_pure_modules_credentials_are_put_where_they_look_for_them(self, monkeypatch):
        monkeypatch.delenv("LOKI_TOKEN", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setattr(h, "_secrets", {"LOKI_TOKEN": "loki-secret", "ANTHROPIC_API_KEY": "sk-secret"})

        h._hydrate_environment()

        assert h.os.environ["LOKI_TOKEN"] == "loki-secret"
        assert h.os.environ["ANTHROPIC_API_KEY"] == "sk-secret"

    def test_hydration_does_not_overwrite_a_credential_already_set(self, monkeypatch):
        monkeypatch.setenv("LOKI_TOKEN", "set-by-hand")
        monkeypatch.setattr(h, "_secrets", {"LOKI_TOKEN": "from-the-bundle"})

        h._hydrate_environment()

        assert h.os.environ["LOKI_TOKEN"] == "set-by-hand"
