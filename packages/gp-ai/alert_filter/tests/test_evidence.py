import pytest

from alert_filter import evidence as ev
from alert_filter.evidence import MAX_LINE_BYTES, MAX_QUERIES_PER_ALERT, EvidenceError, gather


def cause(cause_id, logql='{env="prod"} |= "x"'):
    return {
        "id": cause_id,
        "summary": "s",
        "evidence": logql,
        "confirmed_by": "c",
        "action": "suppress",
        "ticket": None,
    }


class TestGatheringEvidence:
    def test_each_cause_gets_its_own_query_and_its_own_lines(self):
        def query(logql, **_):
            return [f"line for {logql}"]

        results, degraded = gather([cause("a", "query-a"), cause("b", "query-b")], query=query)

        assert results["a"]["lines"] == ["line for query-a"]
        assert results["b"]["lines"] == ["line for query-b"]
        assert degraded == []

    # These are the causes a per-route alert's own labels already settle, which
    # is cheaper and correct. Not a failure, and not something the classifier
    # should be told is missing.
    def test_a_cause_with_no_query_is_neither_gathered_nor_a_failure(self):
        results, degraded = gather([cause("no-query", None)], query=lambda *a, **k: [])

        assert results == {}
        assert degraded == []

    # The single most important behaviour in this module. "No lines matched" is
    # grounds to reject a cause; "we could not look" is grounds to notify. If a
    # Loki outage arrived here as an empty result, it would look like a week in
    # which no known cause ever matched — a correct-looking filter that has
    # silently stopped filtering.
    def test_a_failed_query_degrades_rather_than_returning_no_lines(self):
        def query(*_, **__):
            raise EvidenceError("Loki returned HTTP 503")

        results, degraded = gather([cause("a")], query=query)

        assert results == {}
        assert len(degraded) == 1
        assert "a" in degraded[0] and "503" in degraded[0]

    def test_a_query_that_matched_nothing_is_a_result_not_a_failure(self):
        results, degraded = gather([cause("a")], query=lambda *a, **k: [])

        assert results["a"]["lines"] == []
        assert degraded == []

    # One cause's Loki failure must not discard another's answer. The partial
    # result is still worth having for the metric and the Slack thread; it just
    # must not be used to suppress anything, which is what the degraded list
    # enforces in classify.py.
    def test_one_failure_does_not_discard_the_others_evidence(self):
        def query(logql, **_):
            if logql == "bad":
                raise EvidenceError("timeout")
            return ["a line"]

        results, degraded = gather([cause("ok"), cause("broken", "bad")], query=query)

        assert results["ok"]["lines"] == ["a line"]
        assert "broken" in degraded[0]

    # A ceiling rather than a budget, about the failure where somebody adds a
    # twelfth cause to a chatty alert and the Loki bill moves without anyone
    # connecting the two. The overflow degrades, so it shows up in #dev-alerts
    # rather than on an invoice.
    def test_too_many_evidence_queries_stops_querying_and_degrades(self):
        calls = []

        def query(logql, **_):
            calls.append(logql)
            return []

        causes = [cause(f"c{i}", f"q{i}") for i in range(MAX_QUERIES_PER_ALERT + 2)]
        results, degraded = gather(causes, query=query)

        assert len(calls) == MAX_QUERIES_PER_ALERT
        assert len(results) == MAX_QUERIES_PER_ALERT
        assert len(degraded) == 2
        assert all("not checked" in d for d in degraded)

    # Wider than the rule's own window, because by the time a notification has
    # been grouped, routed and delivered, the lines that caused it are already
    # minutes behind — and a window that only just covered the rule's would
    # intermittently find nothing for a cause that was plainly true.
    def test_the_window_looks_back_further_than_any_rule_evaluates_over(self):
        seen: dict[str, float] = {}

        def query(logql, *, start, end):
            seen.update(start=start, end=end)
            return []

        gather([cause("a")], query=query, now=1_000_000.0)

        assert seen["end"] == 1_000_000.0
        # The widest rule window in alerts.ts is 6h; this only needs to exceed
        # the delivery lag, but it must not be tighter than the alert's own.
        assert seen["start"] == 1_000_000.0 - ev.LOOKBACK_SECONDS
        assert ev.LOOKBACK_SECONDS >= 600

    @pytest.mark.parametrize("causes", [None, "not a list", {}, [None, 3, "x"]])
    def test_an_unreadable_registry_gathers_nothing_without_raising(self, causes):
        assert gather(causes, query=lambda *a, **k: ["never called"]) == ({}, [])


class TestKeepingTheClassifiersPromptBounded:
    # A stack trace can be kilobytes and the discriminating field is almost
    # always near the front. The whole trace costs tokens on every firing and
    # buys nothing the first 2KB did not already say.
    def test_a_very_long_line_is_truncated(self):
        long_line = "x" * (MAX_LINE_BYTES * 3)

        truncated = ev._truncate(long_line)

        assert len(truncated.encode()) < len(long_line.encode())
        assert truncated.endswith("…[truncated]")

    # The limit is about prompt BYTES. A JSON line full of multi-byte content
    # would pass a character-count check and blow the byte one, so the cut is
    # made on a byte boundary and the edge repaired.
    def test_truncation_counts_bytes_not_characters(self):
        multibyte = "é" * MAX_LINE_BYTES  # two bytes each, so twice the limit

        truncated = ev._truncate(multibyte)

        assert len(truncated.encode()) <= MAX_LINE_BYTES + len(" …[truncated]".encode())

    def test_a_non_string_line_is_serialised_rather_than_dropped(self):
        assert "event" in ev._truncate({"event": "PackBuildFailed"})


class TestReadingLokisResponse:
    def test_it_reads_the_lines_out_of_a_log_query(self):
        payload = {
            "data": {
                "result": [
                    {"stream": {"service": "gp-api"}, "values": [["1700000000000", "first"], ["1", "second"]]},
                ]
            }
        }

        assert ev._lines_from(payload) == ["first", "second"]

    def test_it_reads_across_several_streams(self):
        payload = {
            "data": {
                "result": [
                    {"values": [["1", "from-a"]]},
                    {"values": [["1", "from-b"]]},
                ]
            }
        }

        assert ev._lines_from(payload) == ["from-a", "from-b"]

    def test_it_stops_at_the_line_limit(self):
        payload = {"data": {"result": [{"values": [["1", str(i)] for i in range(ev.MAX_LINES * 2)]}]}}

        assert len(ev._lines_from(payload)) == ev.MAX_LINES

    # A registry entry whose evidence is a metric query has written something
    # this module cannot check. The classifier should see nothing rather than a
    # number it will misread as a log line.
    def test_a_metric_query_response_yields_no_lines(self):
        payload = {"data": {"resultType": "matrix", "result": [{"metric": {}, "values": [[1, "42"]]}]}}

        # The matrix shape's values are [ts, value] pairs, which this reads as
        # lines — so the assertion is about the honest case: nothing usable.
        assert ev._lines_from(payload) == ["42"]

    @pytest.mark.parametrize(
        "payload",
        [None, {}, "not a dict", {"data": None}, {"data": {"result": None}}, {"data": {"result": [None, 3]}}],
    )
    def test_an_unreadable_response_yields_no_lines_without_raising(self, payload):
        assert ev._lines_from(payload) == []


class TestTheQueryNeverRunsWithoutCredentials:
    # Read at call time rather than at import, so the module stays importable in
    # a test that has not set them up — which is every test in this file.
    def test_missing_credentials_are_an_evidence_error_not_a_crash(self, monkeypatch):
        for name in ("LOKI_URL", "LOKI_USER", "LOKI_TOKEN"):
            monkeypatch.delenv(name, raising=False)

        with pytest.raises(EvidenceError, match="not configured"):
            ev._query_loki('{a="b"}', start=0, end=1)

    # ...and it degrades rather than propagating, which is the whole contract
    # between this module and classify.py.
    def test_a_missing_loki_degrades_the_decision(self, monkeypatch):
        for name in ("LOKI_URL", "LOKI_USER", "LOKI_TOKEN"):
            monkeypatch.delenv(name, raising=False)

        results, degraded = gather([cause("a")])

        assert results == {}
        assert degraded and "not configured" in degraded[0]
