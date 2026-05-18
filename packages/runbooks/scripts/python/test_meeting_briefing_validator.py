"""Tests for experiments/meeting_briefing/validate_output.py.

Specifically locks the contract claimed by instruction.md: when the agent
declares awaiting_agenda or no_meeting_found, the validator MUST reject the
artifact unless all 7 discovery channels are represented in
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
# the source lives in experiments/meeting_briefing/attachments/qa_checks.py
# and the publisher rejects any subdirectory under attachments/ as malformed.
# A leftover __pycache__ from running these tests would break `publish_experiments.py`.
sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = REPO_ROOT / "experiments" / "meeting_briefing" / "attachments" / "qa_checks.py"


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


def _all_seven_decisions() -> list[dict]:
    return [_decision(n) for n in range(1, 8)]


class TestAwaitingAgendaDiscoveryDepth:
    def test_awaiting_agenda_with_all_7_channels_passes(self):
        v = _load_validator()
        artifact = {
            "briefing_status": "awaiting_agenda",
            "run_metadata": {"run_decisions": _all_seven_decisions()},
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []

    def test_awaiting_agenda_missing_a_channel_fails(self):
        v = _load_validator()
        # drop channel 4 (the CDN-search channel — the Fulshear-pattern fix)
        decisions = [_decision(n) for n in range(1, 8) if n != 4]
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
        count is high. Channels 2-7 are still untouched.
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
        assert "[2, 3, 4, 5, 6, 7]" in findings[0].message

    def test_briefing_ready_skips_the_check(self):
        """Full-briefing branch: check does not apply. An agent that finds the
        packet on channel 1 shouldn't be punished for not probing channels 2-7."""
        v = _load_validator()
        artifact = {
            "briefing_status": "briefing_ready",
            "run_metadata": {"run_decisions": [_decision(1)]},  # just channel 1
        }
        findings: list = []
        v.check_awaiting_agenda_discovery_depth(artifact, findings)
        assert findings == []

    def test_no_meeting_found_also_requires_all_7(self):
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
        decisions = _all_seven_decisions() + [
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
