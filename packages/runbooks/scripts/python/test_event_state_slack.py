import json

import event_state_slack as slk


# --- fixtures ----------------------------------------------------------------


def _flatten_text(blocks):
    """Concatenate every text string in a Block Kit block list for substring asserts."""
    out = []
    for b in blocks:
        t = b.get("text")
        if isinstance(t, dict):
            out.append(t.get("text", ""))
        for el in b.get("elements", []) or []:
            if isinstance(el, dict):
                out.append(el.get("text", ""))
    return "\n".join(out)


CREATED = {
    "event": "Onboarding Step Completed",
    "change_type": "created",
    "status": "active",
    "product": "product:win",
    "family": "win_onboarding",
    "purpose": "Fires when a candidate completes an onboarding step.",
    "source": "PR #591",
    "author": "tristan",
    "supersession": "original",
    "sheet_url": "https://sheet.example/events",
}

RETIRED = {
    "event": "Old Share Click",
    "change_type": "retired",
    "status": "retired",
    "product": "product:serve",
    "family": "serve_sharing",
    "purpose": "Legacy share button click.",
    "source": "manual (dev feedback)",
    "author": "tristan",
    "supersession": "superseded by Share Link Copied",
    "sheet_url": "https://sheet.example/events",
}

# result / changes shaped like analytics_event_health.reconcile() + diff_flagged()
RESULT = {
    "run_date": "2026-07-01",
    "total_events": 472,
    "status_counts": {"active": 312, "dormant": 88, "retired": 72},
    "proposals": [
        {"event_type": "ai_chat_message_sent", "family": "win_ai", "first_seen_date": "2026-06-20"},
    ],
    "flagged": [
        {"event_type": "donation_submitted", "status": "active", "family": "serve_donate",
         "event_count_30d": 96, "anomaly": {"current": 96, "baseline": 1204.0}, "rank": 4},
        {"event_type": "meeting_rsvp", "status": "active", "family": "win_onboarding",
         "event_count_30d": 40, "anomaly": None, "rank": 6},
        {"event_type": "poll_created", "status": "dormant", "family": "win_polls",
         "event_count_30d": 0, "anomaly": None, "rank": 8},
    ],
}

PRIOR = {"poll_created": "active"}  # poll_created escalated active -> dormant
CHANGES = {"new": ["donation_submitted", "meeting_rsvp"], "resolved": [],
           "still_open": [], "escalated": ["poll_created"]}
QUIET = {"new": [], "resolved": [], "still_open": ["x"], "escalated": []}


# --- sheet_url derivation ----------------------------------------------------


def test_sheet_url_prefers_explicit_override(monkeypatch):
    monkeypatch.setenv("GP_EVENT_STATE_SHEET_URL", "https://custom/link")
    monkeypatch.setenv("GP_EVENT_STATE_SHEET_ID", "abc123")
    assert slk.sheet_url() == "https://custom/link"


def test_sheet_url_derives_from_sheet_id(monkeypatch):
    monkeypatch.delenv("GP_EVENT_STATE_SHEET_URL", raising=False)
    monkeypatch.setenv("GP_EVENT_STATE_SHEET_ID", "abc123")
    assert slk.sheet_url() == "https://docs.google.com/spreadsheets/d/abc123/edit"


def test_sheet_url_none_when_unset(monkeypatch):
    monkeypatch.delenv("GP_EVENT_STATE_SHEET_URL", raising=False)
    monkeypatch.delenv("GP_EVENT_STATE_SHEET_ID", raising=False)
    assert slk.sheet_url() is None


# --- Source A: build_metadata_blocks -----------------------------------------


def test_metadata_created_headline_and_fields():
    blocks = slk.build_metadata_blocks(CREATED)
    text = _flatten_text(blocks)
    assert blocks[0]["type"] == "header"
    assert "🆕" in blocks[0]["text"]["text"]
    assert "Onboarding Step Completed" in text
    assert "active" in text and "win_onboarding" in text
    assert "onboarding step" in text.lower()
    assert "PR #591" in text and "tristan" in text
    assert "https://sheet.example/events" in text


def test_metadata_retired_shows_supersession():
    blocks = slk.build_metadata_blocks(RETIRED)
    text = _flatten_text(blocks)
    assert "♻️" in blocks[0]["text"]["text"]
    assert "superseded by Share Link Copied" in text
    assert "manual (dev feedback)" in text


def test_metadata_updated_lists_changed_fields():
    change = dict(CREATED, change_type="updated", changed=["purpose", "tags"])
    blocks = slk.build_metadata_blocks(change)
    text = _flatten_text(blocks)
    assert "✏️" in blocks[0]["text"]["text"]
    assert "purpose" in text and "tags" in text


# --- should_post gate --------------------------------------------------------


def test_should_post_true_on_new():
    assert slk.should_post(RESULT, CHANGES) is True


def test_should_post_true_on_resolved_only():
    assert slk.should_post(RESULT, {"new": [], "resolved": ["x"], "still_open": [], "escalated": []}) is True


def test_should_post_true_on_escalated_only():
    assert slk.should_post(RESULT, {"new": [], "resolved": [], "still_open": [], "escalated": ["poll_created"]}) is True


def test_should_post_false_when_quiet_and_persistent_anomaly():
    # nothing changed and the only anomaly (donation_submitted) was already anomalous last
    # run → not news, stay quiet (don't re-post a persistent anomaly every run)
    assert slk.should_post(RESULT, QUIET, prior_anomalous={"donation_submitted"}) is False


def test_should_post_true_on_new_anomaly_even_if_no_changes():
    # no status changes, but donation_submitted's anomaly is new (absent from prior run)
    assert slk.should_post(RESULT, QUIET, prior_anomalous=set()) is True


def test_should_post_true_when_still_open_event_develops_anomaly():
    # the delegate scenario: an event flagged in both runs (still_open) that develops an
    # anomaly this run must surface; once the anomaly persists to the next run, go quiet
    changes = {"new": [], "resolved": [], "still_open": ["donation_submitted"], "escalated": []}
    assert slk.should_post(RESULT, changes, prior_anomalous=set()) is True
    assert slk.should_post(RESULT, changes, prior_anomalous={"donation_submitted"}) is False


def test_should_post_suppresses_anomaly_flood_when_prior_unknown():
    # prior_anomalous=None: no prior-anomaly knowledge (no state file, corrupt, or a file
    # written before the key existed — the first --slack run on an established deployment).
    # A pre-existing anomaly must NOT flood the channel; None is distinct from an empty set,
    # which means the prior run is known to have had zero anomalies.
    assert slk.should_post(RESULT, QUIET, prior_anomalous=None) is False


# --- Source B: build_digest_blocks -------------------------------------------


def test_digest_returns_parent_and_thread():
    parent, thread = slk.build_digest_blocks(RESULT, CHANGES, PRIOR)
    assert isinstance(parent, list) and isinstance(thread, list)
    assert parent and thread


def test_digest_parent_renders_transitions_and_counts():
    parent, _ = slk.build_digest_blocks(RESULT, CHANGES, PRIOR)
    text = _flatten_text(parent)
    assert "📊" in parent[0]["text"]["text"]
    assert "2026-07-01" in text
    # escalated transition rendered prior -> current
    assert "poll_created" in text and "active" in text and "dormant" in text
    # newly flagged events surface
    assert "donation_submitted" in text or "meeting_rsvp" in text
    # status breakdown headline present
    assert "312" in text


def test_digest_thread_renders_anomaly_numbers_and_proposals():
    _, thread = slk.build_digest_blocks(RESULT, CHANGES, PRIOR)
    text = _flatten_text(thread)
    assert "donation_submitted" in text
    assert "1,204" in text and "96" in text          # baseline -> current, thousands-formatted
    assert "ai_chat_message_sent" in text            # proposal listed


def test_digest_escalated_without_prior_state_is_graceful():
    parent, _ = slk.build_digest_blocks(RESULT, CHANGES, None)
    text = _flatten_text(parent)
    assert "poll_created" in text  # still rendered even when prior status unknown


def test_digest_thread_truncates_proposals_with_overflow_indicator():
    # >TRANSITION_CAP proposals must show an overflow hint, not silently drop entries.
    many = {
        **RESULT,
        "proposals": [
            {"event_type": f"evt_{i}", "family": "win_ai", "first_seen_date": "2026-06-20"}
            for i in range(slk.TRANSITION_CAP + 5)
        ],
    }
    _, thread = slk.build_digest_blocks(many, CHANGES, PRIOR)
    text = _flatten_text(thread)
    assert "evt_0" in text                              # first proposal shown
    assert "evt_19" not in text                         # entry past the cap is dropped from the list
    assert "…and 5 more" in text                        # overflow indicator present


# --- gap section (Task 5: folded into the health digest) ---------------------


def test_gap_has_news():
    assert slk.gap_has_news({"new_count": 2}) is True
    assert slk.gap_has_news({"new_count": 0}) is False
    assert slk.gap_has_news(None) is False


def test_gap_summary_line_three_states():
    assert "3 new" in slk.build_gap_summary_line(
        {"new_count": 3, "status": "ok", "pending_count": 0})
    assert "No new" in slk.build_gap_summary_line(
        {"new_count": 0, "status": "ok", "pending_count": 0})
    line = slk.build_gap_summary_line(
        {"new_count": 0, "status": "skipped: ANTHROPIC_API_KEY unset", "pending_count": 7})
    assert "unavailable" in line and "7" in line
    # singular form regression guard: no trailing "s" for exactly one new gap
    singular = slk.build_gap_summary_line({"new_count": 1, "status": "ok", "pending_count": 0})
    assert "1 new instrumentation gap" in singular
    assert "1 new instrumentation gaps" not in singular


def test_gap_thread_blocks_empty_when_no_new_gaps():
    assert slk.build_gap_thread_blocks({"new_gaps": [], "browse_url": "http://browse"}) == []
    assert slk.build_gap_thread_blocks({}) == []


def test_gap_thread_blocks_renders_ranked_list_and_links():
    gap = {"new_count": 1, "status": "ok", "pending_count": 0,
           "new_gaps": [{"rank": 0, "id": "/a", "surface_type": "route",
                         "rubric_rule": "flow", "dashboard_question": "q", "location": "a.tsx"}],
           "browse_url": "http://browse", "feedback_url": "http://fb"}
    blocks = slk.build_gap_thread_blocks(gap)
    text = _flatten_text(blocks)
    assert "/a" in text and "http://browse" in text and "http://fb" in text


def test_gap_thread_blocks_shows_overflow_when_capped():
    gap = {
        "new_count": 15,
        "new_gaps": [
            {"rank": 0, "id": f"/g{i}", "surface_type": "route",
             "rubric_rule": "flow", "dashboard_question": "q", "location": f"g{i}.tsx"}
            for i in range(10)
        ],
        "browse_url": "http://browse", "feedback_url": "http://fb",
    }
    blocks = slk.build_gap_thread_blocks(gap)
    text = _flatten_text(blocks)
    assert "5 more" in text


def test_gap_thread_blocks_omits_absent_link_label():
    gap = {"new_count": 1, "status": "ok", "pending_count": 0,
           "new_gaps": [{"rank": 0, "id": "/a", "surface_type": "route",
                         "rubric_rule": "flow", "dashboard_question": "q", "location": "a.tsx"}],
           "browse_url": "http://browse", "feedback_url": None}
    text = _flatten_text(slk.build_gap_thread_blocks(gap))
    assert "Browse gaps" in text
    assert "Set disposition" not in text


def test_gap_thread_shows_triage_invocation():
    gap = {
        "status": "ok", "run_date": "2026-08-03", "new_count": 1,
        "new_gaps": [{"rank": 1, "id": "a", "surface_type": "route",
                      "rubric_rule": "flow", "dashboard_question": "q",
                      "location": "app/x/page.tsx"}],
        "browse_url": "https://sheet", "feedback_url": "https://gh",
    }
    blocks = slk.build_gap_thread_blocks(gap)
    flat = json.dumps(blocks)
    assert "/triage-instrumentation-gaps 2026-08-03" in flat


def test_should_post_true_on_gap_news_even_if_health_quiet():
    quiet_changes = {"new": [], "escalated": [], "resolved": [], "still_open": ["x"]}
    assert slk.should_post({"flagged": []}, quiet_changes, None, {"new_count": 1}) is True


def test_should_post_false_when_gap_none_and_health_quiet():
    assert slk.should_post(RESULT, QUIET, prior_anomalous={"donation_submitted"}, gap=None) is False


def test_build_digest_blocks_unchanged_when_gap_none():
    # header names the gap sweep unconditionally (Task 5 brief), but with gap=None no
    # gaps summary line or thread detail is appended — the compass emoji marks that line.
    parent, thread = slk.build_digest_blocks(RESULT, CHANGES, PRIOR)
    text = _flatten_text(parent)
    assert "🧭" not in text
    assert "📊 Analytics event health & instrumentation gaps —" in parent[0]["text"]["text"]


def test_build_digest_blocks_appends_gap_line_and_thread():
    gap = {"new_count": 1, "status": "ok", "pending_count": 0,
           "new_gaps": [{"rank": 0, "id": "/a", "surface_type": "route",
                         "rubric_rule": "flow", "dashboard_question": "q", "location": "a.tsx"}],
           "browse_url": "http://browse", "feedback_url": "http://fb"}
    parent, thread = slk.build_digest_blocks(RESULT, CHANGES, PRIOR, None, gap)
    ptext = _flatten_text(parent)
    assert "instrumentation gaps" in ptext.lower()
    assert "1 new" in ptext
    ttext = _flatten_text(thread)
    assert "/a" in ttext and "http://browse" in ttext and "http://fb" in ttext


def test_post_digest_threads_gap_through(monkeypatch):
    tx = _FakeTransport()
    gap = {"new_count": 1, "status": "ok", "pending_count": 0, "new_gaps": [],
           "browse_url": "http://browse", "feedback_url": "http://fb"}
    ts = slk.post_digest(RESULT, QUIET, PRIOR, token="xoxb-t", channel="C0BECEK0603",
                         transport=tx, prior_anomalous={"donation_submitted"}, gap=gap)
    # health side is quiet, but gap has news -> should still post
    assert ts == "1111.1"
    assert len(tx.calls) == 2


# --- poster (injected transport) ---------------------------------------------


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


class _FakeTransport:
    def __init__(self, ts_seq=("1111.1", "2222.2")):
        self.calls = []
        self._ts = list(ts_seq)

    def __call__(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        i = len(self.calls) - 1
        ts = self._ts[i] if i < len(self._ts) else "9999.9"
        return _FakeResp({"ok": True, "ts": ts})


def test_post_message_posts_blocks_and_returns_ts():
    tx = _FakeTransport()
    ts = slk.post_message([{"type": "section", "text": {"type": "mrkdwn", "text": "hi"}}],
                          token="xoxb-t", channel="C0BECEK0603", text="hi", transport=tx)
    assert ts == "1111.1"
    assert len(tx.calls) == 1
    call = tx.calls[0]
    assert call["url"] == slk.SLACK_POST_URL
    assert call["headers"]["Authorization"] == "Bearer xoxb-t"
    assert call["json"]["channel"] == "C0BECEK0603"
    assert call["json"]["text"] == "hi"


def test_post_message_raises_on_slack_error():
    def bad_transport(url, **kwargs):
        return _FakeResp({"ok": False, "error": "channel_not_found"})

    try:
        slk.post_message([], token="t", channel="c", transport=bad_transport)
    except RuntimeError as e:
        assert "channel_not_found" in str(e)
    else:
        raise AssertionError("expected RuntimeError on ok:false")


def test_post_digest_posts_parent_then_threaded_reply():
    tx = _FakeTransport()
    ts = slk.post_digest(RESULT, CHANGES, PRIOR, token="xoxb-t", channel="C0BECEK0603", transport=tx)
    assert ts == "1111.1"
    assert len(tx.calls) == 2
    # parent has no thread_ts; reply threads under the parent ts
    assert "thread_ts" not in tx.calls[0]["json"]
    assert tx.calls[1]["json"]["thread_ts"] == "1111.1"
    # notification-preview fallback text matches the header block's naming
    assert tx.calls[0]["json"]["text"] == f"Analytics event health & instrumentation gaps — {RESULT['run_date']}"


def test_post_digest_survives_thread_failure_and_returns_parent_ts():
    # parent posts fine; the threaded reply raises — the parent is meaningful on its own,
    # so post_digest must swallow the thread error and still return the parent ts.
    calls = []

    def flaky(url, **kwargs):
        calls.append(kwargs["json"])
        if "thread_ts" in kwargs["json"]:
            raise RuntimeError("rate_limited")
        return _FakeResp({"ok": True, "ts": "1111.1"})

    ts = slk.post_digest(RESULT, CHANGES, PRIOR, token="xoxb-t", channel="C0BECEK0603", transport=flaky)
    assert ts == "1111.1"
    assert len(calls) == 2  # parent + attempted thread reply


def test_post_digest_noop_when_quiet():
    tx = _FakeTransport()
    # quiet: no status changes and the anomaly persisted from last run
    ts = slk.post_digest(RESULT, QUIET, PRIOR, token="xoxb-t", channel="C0BECEK0603",
                         transport=tx, prior_anomalous={"donation_submitted"})
    assert ts is None
    assert tx.calls == []


# --- CLI host-gate -----------------------------------------------------------


def test_main_notify_metadata_skips_cleanly_without_env(monkeypatch, capsys):
    monkeypatch.delenv(slk.TOKEN_ENV, raising=False)
    monkeypatch.delenv(slk.CHANNEL_ENV, raising=False)
    rc = slk.main(["notify-metadata", "--event", "X", "--change", "created", "--status", "active"])
    assert rc == 0
    assert "not configured" in capsys.readouterr().err.lower()


def test_main_notify_metadata_posts_when_configured(monkeypatch):
    monkeypatch.setenv(slk.TOKEN_ENV, "xoxb-t")
    monkeypatch.setenv(slk.CHANNEL_ENV, "C0BECEK0603")
    tx = _FakeTransport()
    monkeypatch.setattr(slk.requests, "post", tx)
    rc = slk.main(["notify-metadata", "--event", "X", "--change", "created",
                   "--status", "active", "--source", "PR #1", "--author", "tristan"])
    assert rc == 0
    assert len(tx.calls) == 1
    assert tx.calls[0]["json"]["channel"] == "C0BECEK0603"


def test_main_notify_metadata_is_nonfatal_on_slack_error(monkeypatch, capsys):
    # the shell wrapper runs under `set -e`, so a Slack failure must NOT become a non-zero
    # exit — the Amplitude write it follows has already succeeded.
    monkeypatch.setenv(slk.TOKEN_ENV, "xoxb-t")
    monkeypatch.setenv(slk.CHANNEL_ENV, "C0BECEK0603")

    def failing_post(url, **kwargs):
        return _FakeResp({"ok": False, "error": "ratelimited"})

    monkeypatch.setattr(slk.requests, "post", failing_post)
    rc = slk.main(["notify-metadata", "--event", "X", "--change", "created", "--status", "active"])
    assert rc == 0
    assert "failed" in capsys.readouterr().err.lower()


# --- tiered digest (DATA-2174) -------------------------------------------------


def _triage(items, status="ok"):
    return {"status": status, "items": items}


def _titem(event, tier, *, headline="h", action="", okr=None, change="new",
           prior_status=None, status="dormant", pr=None):
    return {"id": event, "event_type": event, "tier": tier, "rules_tier": tier,
            "headline": headline, "action": action, "okr": okr, "change": change,
            "prior_status": prior_status, "status": status, "instrumented_pr": pr}


def _tiered_result(**kw):
    base = {"run_date": "2026-08-04", "flagged": [], "proposals": [],
            "status_counts": {"active": 300}, "total_events": 300}
    base.update(kw)
    return base


NOCHG = {"new": [], "escalated": [], "resolved": [], "still_open": []}


def test_should_post_true_on_red_open_alone():
    assert slk.should_post(_tiered_result(), NOCHG, set(), None, red_open=True)
    assert not slk.should_post(_tiered_result(), NOCHG, set(), None, red_open=False)


def test_tiered_parent_orders_red_yellow_fyi():
    triage = _triage([
        _titem("OkrEvent", "red", headline="went quiet", action="check PR #1124",
               okr="Active Candidates"),
        _titem("WatchEvent", "yellow", headline="newly dormant"),
        _titem("PlainEvent", "fyi"),
    ])
    changes = {"new": ["OkrEvent", "WatchEvent", "PlainEvent"], "escalated": [],
               "resolved": [], "still_open": []}
    parent, thread = slk.build_digest_blocks(
        _tiered_result(), changes, {}, set(), gap=None, triage=triage)
    text = _flatten_text(parent)
    assert "🔴 Needs action (1)" in text
    assert "OKR: Active Candidates" in text
    assert "went quiet" in text and "→ check PR #1124" in text
    assert "🟡 Worth watching (1)" in text
    assert text.index("🔴") < text.index("🟡") < text.index("ℹ️")
    assert "1 informational change" in text
    # fyi detail lives in the thread, not the parent
    assert "PlainEvent" not in text
    assert "PlainEvent" in _flatten_text(thread)


def test_tiered_parent_mentions_only_when_red(monkeypatch):
    monkeypatch.delenv("SLACK_EVENT_ALERT_MENTION", raising=False)
    red = _triage([_titem("E", "red", okr="Signups")])
    changes = {"new": ["E"], "escalated": [], "resolved": [], "still_open": []}
    parent, _ = slk.build_digest_blocks(_tiered_result(), changes, {}, set(), triage=red)
    assert "<!here>" in _flatten_text(parent)

    yellow = _triage([_titem("E", "yellow")])
    parent, _ = slk.build_digest_blocks(_tiered_result(), changes, {}, set(), triage=yellow)
    assert "<!here>" not in _flatten_text(parent)


def test_tiered_parent_mention_env_override(monkeypatch):
    monkeypatch.setenv("SLACK_EVENT_ALERT_MENTION", "<!subteam^S123>")
    red = _triage([_titem("E", "red", okr="Signups")])
    changes = {"new": ["E"], "escalated": [], "resolved": [], "still_open": []}
    parent, _ = slk.build_digest_blocks(_tiered_result(), changes, {}, set(), triage=red)
    text = _flatten_text(parent)
    assert "<!subteam^S123>" in text and "<!here>" not in text


def test_tiered_yellow_caps_with_overflow():
    items = [_titem(f"E{i}", "yellow") for i in range(12)]
    changes = {"new": [i["id"] for i in items], "escalated": [], "resolved": [],
               "still_open": []}
    parent, _ = slk.build_digest_blocks(
        _tiered_result(), changes, {}, set(), triage=_triage(items))
    text = _flatten_text(parent)
    assert "🟡 Worth watching (12)" in text and "…and 2 more" in text


def test_tiered_triage_failure_shows_fallback_note():
    triage = _triage([_titem("E", "yellow")], status="failed: api down")
    changes = {"new": ["E"], "escalated": [], "resolved": [], "still_open": []}
    parent, _ = slk.build_digest_blocks(_tiered_result(), changes, {}, set(), triage=triage)
    assert "triage judgment unavailable" in _flatten_text(parent)


def test_thread_groups_new_events_by_pr():
    triage = _triage([
        _titem("A", "fyi", pr="https://github.com/thegoodparty/omni/pull/1049"),
        _titem("B", "fyi", pr="https://github.com/thegoodparty/omni/pull/1049"),
        _titem("C", "fyi", pr=None),
    ])
    changes = {"new": ["A", "B", "C"], "escalated": [], "resolved": [], "still_open": []}
    _, thread = slk.build_digest_blocks(_tiered_result(), changes, {}, set(), triage=triage)
    text = _flatten_text(thread)
    assert "<https://github.com/thegoodparty/omni/pull/1049|PR #1049> — 2 new events" in text
    assert "`C`" in text


def test_legacy_layout_unchanged_when_triage_none():
    result = _tiered_result()
    changes = {"new": ["X"], "escalated": [], "resolved": [], "still_open": []}
    legacy = slk.build_digest_blocks(result, changes, {}, set(), gap=None)
    explicit = slk.build_digest_blocks(result, changes, {}, set(), gap=None, triage=None)
    assert legacy == explicit
    assert "Needs action" not in _flatten_text(legacy[0])
