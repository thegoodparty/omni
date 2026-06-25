"""Tests for experiments/meeting_briefing/qa/qa_checks.py.

Specifically locks the contract claimed by instruction.md: when the agent
declares awaiting_agenda or no_meeting_found, the validator MUST reject the
artifact unless all 4 discovery channels are represented in
run_metadata.run_decisions[] (via `channel_<N>_*` decision prefixes).

The validator is the only thing standing between an agent that bails after
one channel and a published artifact that lies about depth of effort.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Prevent importlib from writing __pycache__ alongside the source file —
# the source lives in experiments/meeting_briefing/qa/qa_checks.py and the
# publisher rejects any subdirectory under qa/ as malformed. A leftover
# __pycache__ from running these tests would break `publish_experiments.py`.
sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = REPO_ROOT / "experiments" / "meeting_briefing" / "qa" / "qa_checks.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("mb_validate", VALIDATOR_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mb_validate"] = mod
    spec.loader.exec_module(mod)
    return mod


def _decision(channel_n: int) -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "decision": f"channel_{channel_n}_probed",
        "reason": "details",
    }


def _all_four_decisions() -> list[dict]:
    return [_decision(n) for n in range(1, 5)]


class TestAwaitingAgendaDiscoveryDepth:
    def test_awaiting_agenda_with_all_4_channels_passes(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {"run_decisions": _all_four_decisions()},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []

    def test_awaiting_agenda_missing_a_channel_fails(self):
        v = _load_validator()
        # drop channel 4 (the CDN-search channel — the Fulshear-pattern fix)
        decisions = [_decision(n) for n in range(1, 5) if n != 4]
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {"run_decisions": decisions},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        f = findings[0]
        assert f.check == "run_decisions.discovery_channels_incomplete"
        assert f.severity == "error"
        assert "[4]" in f.message
        assert "channel_<N>_" in f.message

    def test_ten_channel_1_subplatforms_do_not_clear_the_gate(self):
        """The bot's compounding-problem case: an agent that runs 10 sub-platforms
        under channel 1 and emits 10 separate run_decisions entries (all with
        decision='channel_1_*') must NOT clear the validator just because the
        count is high. Channels 2-4 are still untouched.
        """
        v = _load_validator()
        decisions = [_decision(1) for _ in range(10)]  # 10 channel_1 entries, no others
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {"run_decisions": decisions},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        assert "[2, 3, 4]" in findings[0].message

    def test_briefing_ready_skips_the_check(self):
        """Full-briefing branch: check does not apply. An agent that finds the
        packet on channel 1 shouldn't be punished for not probing channels 2-4."""
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {"run_decisions": [_decision(1)]},  # just channel 1
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []

    def test_no_meeting_found_also_requires_all_4(self):
        """no_meeting_found uses the same exhaustion gate."""
        v = _load_validator()
        artifact = {
            "briefing_status": "no_meeting_found",
            "run_metadata": {"run_decisions": [_decision(1), _decision(2)]},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        assert "no_meeting_found" in findings[0].message

    def test_unrelated_decisions_are_ignored_not_treated_as_channels(self):
        """Decisions without the channel_<N>_ prefix shouldn't accidentally
        count as channel attempts. e.g. `derived_city_for_narrative` is a
        normal decision, not a discovery channel."""
        v = _load_validator()
        decisions = _all_four_decisions() + [
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "decision": "derived_city_for_narrative",
                "reason": "Derived 'Cheyenne' from positionName",
            }
        ]
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {"run_decisions": decisions},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []


class TestStaleScheduleExemption:
    """no_meeting_found artifacts that explain themselves with the
    `no_meeting_on_target_date` reason are exempt from the 4-channel gate —
    the agent verified the caller-supplied date and the platform showed no
    meeting, so packet discovery never applied.

    These tests lock the exemption contract so a rename of `reason` to
    `decision`, a typo in _STALE_SCHEDULE_REASONS, or an accidental extension
    of the exemption to awaiting_agenda doesn't silently break (or silently
    over-permit) the gate."""

    def test_exemption_passes_with_no_channel_attempts(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "no_meeting_found",
            "run_metadata": {
                "run_decisions": [
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "decision": "verified_meeting_date",
                        "reason": "no_meeting_on_target_date",
                    }
                ]
            },
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []

    def test_exemption_keys_on_reason_not_decision(self):
        """The exemption matches the `reason` field, not the `decision` field.
        A decision named 'no_meeting_on_target_date' WITHOUT the matching reason
        must NOT trigger the exemption — channels are still required."""
        v = _load_validator()
        artifact = {
            "briefing_status": "no_meeting_found",
            "run_metadata": {
                "run_decisions": [
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "decision": "no_meeting_on_target_date",
                        "reason": "checked the platform calendar and nothing showed",
                    }
                ]
            },
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "run_decisions.discovery_channels_incomplete"

    def test_exemption_does_not_apply_to_awaiting_agenda(self):
        """The exemption is for no_meeting_found only. An awaiting_agenda
        artifact with the same reason still requires the 4-channel sweep."""
        v = _load_validator()
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {
                "run_decisions": [
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "decision": "verified_meeting_date",
                        "reason": "no_meeting_on_target_date",
                    }
                ]
            },
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "run_decisions.discovery_channels_incomplete"

    def test_unrelated_reason_does_not_trigger_exemption(self):
        """A no_meeting_found with a reason NOT in _STALE_SCHEDULE_REASONS
        falls back to the normal channel-exhaustion gate."""
        v = _load_validator()
        artifact = {
            "briefing_status": "no_meeting_found",
            "run_metadata": {
                "run_decisions": [
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "decision": "something_else",
                        "reason": "platform_api_error",
                    }
                ]
            },
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "run_decisions.discovery_channels_incomplete"


class TestDiscoveredAgendaLocation:
    """check_discovered_agenda_location nudges agents toward emitting a usable
    next-run hint. Warning-level (does not block release)."""

    def test_briefing_ready_with_missing_field_warns(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {},
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert len(findings) == 1
        f = findings[0]
        assert f.check == "discovered_agenda_location.missing"
        assert f.severity == "warning"

    def test_briefing_ready_with_null_warns(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {"discovered_agenda_location": None},
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "discovered_agenda_location.missing"

    def test_placeholder_status_with_missing_does_not_warn(self):
        """Only briefing_ready triggers the missing-warning; placeholder runs
        can legitimately have no hint when the parent page was unreachable."""
        v = _load_validator()
        for status in ("awaiting_agenda", "no_meeting_found", "error"):
            artifact = {"briefing_status": status, "run_metadata": {}}
            findings: list = []
            v.check_discovered_agenda_location(artifact, findings)
            assert findings == [], f"unexpected finding for status={status}"

    def test_placeholder_text_warns(self):
        v = _load_validator()
        for placeholder in ("TBD", "unknown", "n/a", "N/A", "none", "?", "-"):
            artifact = {
                "briefing_status": "briefing_ready",
                "run_metadata": {"discovered_agenda_location": placeholder},
            }
            findings: list = []
            v.check_discovered_agenda_location(artifact, findings)
            assert len(findings) == 1, f"expected warning for placeholder={placeholder!r}"
            assert findings[0].check == "discovered_agenda_location.placeholder"

    def test_suspiciously_short_string_warns(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {"discovered_agenda_location": "abc"},
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "discovered_agenda_location.placeholder"

    def test_deep_link_pdf_warns(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {
                "discovered_agenda_location": "https://example.gov/agenda-2026-06-08.pdf",
            },
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "discovered_agenda_location.deep_link"

    def test_deep_link_metaviewer_warns(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {
                "discovered_agenda_location": "https://city.granicus.com/MetaViewer.php?meta_id=12345",
            },
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert len(findings) == 1
        assert findings[0].check == "discovered_agenda_location.deep_link"

    def test_deep_link_per_meeting_patterns_warn(self):
        """Each per-meeting URL pattern listed in _DEEP_LINK_HINTS should
        independently trigger the deep_link warning. Locks the full set
        against silent regressions. Kept in sync with the schedule checker's
        _DEEP_LINK_HINTS."""
        v = _load_validator()
        per_meeting_urls = (
            "https://city.granicus.com/ViewPage.php?meta_id=999",
            "https://legistar.example.gov/matters/12345",
            "https://example.gov/file/12345?action=download",
            "https://legistar.example.gov/LegislationDetail.aspx?ID=98765",
            "https://webapi.legistar.com/v1/example/events/42/eventitems",
            "https://legistar.example.gov/MeetingDetail.aspx?ID=42",
            "https://example.gov/calendar/event/2026-06-08-council-meeting",
        )
        for url in per_meeting_urls:
            artifact = {
                "briefing_status": "briefing_ready",
                "run_metadata": {"discovered_agenda_location": url},
            }
            findings: list = []
            v.check_discovered_agenda_location(artifact, findings)
            assert len(findings) == 1, f"expected deep_link warning for url={url}"
            assert findings[0].check == "discovered_agenda_location.deep_link"

    def test_valid_parent_url_passes(self):
        v = _load_validator()
        for url in (
            "https://example.gov/government/city-council/meetings",
            "https://city.granicus.com/ViewPublisher.php?view_id=5",
            "https://city.primegov.com/Portal/Meeting",
        ):
            artifact = {
                "briefing_status": "briefing_ready",
                "run_metadata": {"discovered_agenda_location": url},
            }
            findings: list = []
            v.check_discovered_agenda_location(artifact, findings)
            assert findings == [], f"unexpected finding for url={url}"

    def test_non_string_value_is_silently_ignored(self):
        """Schema validation catches type errors elsewhere; the QA check
        should not raise on a malformed value."""
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {"discovered_agenda_location": 42},
        }
        findings: list = []
        v.check_discovered_agenda_location(artifact, findings)
        assert findings == []
