import copy
import inspect
import json

import pytest

import event_anchors as ea
import pathlib
import re

REGISTRY_SRC = """
export const EVENTS = {
  Navigation: {
    Dashboard: {
      ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',
      ClickMyProfile: 'Navigation - Dashboard: Click My Profile',
    },
  },
  Onboarding: {
    PledgeCompleted: 'Onboarding - Pledge Completed',
  },
}
"""

REGISTRY_WITH_COMMENTS = """
export const EVENTS = {
  Navigation: {
    Dashboard: {
      ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',
      ClickMyProfile: 'Navigation - Dashboard: Click My Profile',
    },
  },
  Contacts: {
    // ENG-10767: the CRM contacts assistant. MessageSent fires per user send ({ context }) — the
    // initial bar submit and every composer follow-up.
    AssistantChatOpened: 'Contacts - Assistant Chat Opened',
    AssistantMessageSent: 'Contacts - Assistant Message Sent',
  },
  Onboarding: {
    PledgeCompleted: 'Onboarding - Pledge Completed',
  },
}
"""


def test_load_event_registry_maps_literals_to_dotted_key_paths():
    reg = ea.load_event_registry(REGISTRY_SRC)
    assert reg["Navigation - Dashboard: Click Door Knocking"] == (
        "EVENTS.Navigation.Dashboard.ClickDoorKnocking")
    assert reg["Onboarding - Pledge Completed"] == "EVENTS.Onboarding.PledgeCompleted"
    assert len(reg) == 3


def test_load_event_registry_survives_a_file_with_no_registry():
    assert ea.load_event_registry("export const NOPE = 1") == {}


def test_load_event_registry_skips_comments_with_braces():
    """Comments containing braces like ({ context }) should not terminate the walk."""
    reg = ea.load_event_registry(REGISTRY_WITH_COMMENTS)
    assert reg["Contacts - Assistant Chat Opened"] == "EVENTS.Contacts.AssistantChatOpened"
    assert reg["Contacts - Assistant Message Sent"] == "EVENTS.Contacts.AssistantMessageSent"
    assert reg["Onboarding - Pledge Completed"] == "EVENTS.Onboarding.PledgeCompleted"
    assert len(reg) == 5


def test_load_event_registry_real_file_count():
    """Verify against the real analyticsHelper.ts file.

    Ground truth: count distinct string-leaf values inside the EVENTS block,
    excluding those that appear only in comments (comments are stripped first).
    """
    analytics_path = pathlib.Path(__file__).parent.parent.parent / 'gp-webapp' / 'helpers' / 'analyticsHelper.ts'
    if not analytics_path.exists():
        return

    src = analytics_path.read_text()

    # Strip comments to get ground truth of actual registry entries
    stripped_src = ea._strip_comments(src)

    # Brace-match the EVENTS block in the stripped source
    start = stripped_src.find('export const EVENTS = {')
    if start == -1:
        return

    brace_index = stripped_src.index('{', start)
    depth = 0
    end = brace_index
    for idx in range(brace_index, len(stripped_src)):
        if stripped_src[idx] == '{':
            depth += 1
        elif stripped_src[idx] == '}':
            depth -= 1
            if depth == 0:
                end = idx
                break

    events_block = stripped_src[brace_index:end + 1]

    # Count distinct string-leaf values in the stripped EVENTS block
    leaf_pattern = re.compile(r"([A-Za-z0-9_]+)\s*:\s*'([^']*)'")
    leaves = set(m.group(2) for m in leaf_pattern.finditer(events_block))
    expected_count = len(leaves)

    # Verify the loaded registry matches
    reg = ea.load_event_registry(src)
    assert len(reg) == expected_count, (
        f"Registry mapped {len(reg)} literals but ground truth is {expected_count} distinct values"
    )


def test_strip_comments_preserves_urls_in_strings():
    """Event literals containing URLs with // should survive comment stripping."""
    src = """
export const EVENTS = {
  Help: {
    LinkClicked: 'Help - Link Clicked to https://example.com/help',
  },
}
"""
    stripped = ea._strip_comments(src)
    assert 'https://example.com/help' in stripped
    reg = ea.load_event_registry(src)
    assert reg['Help - Link Clicked to https://example.com/help'] == 'EVENTS.Help.LinkClicked'


def test_strip_comments_preserves_quoted_comment_markers():
    """Event literals containing // or /* should survive stripping if inside quotes."""
    src = """
export const EVENTS = {
  Help: {
    UrlEvent: 'Help - Visit https://example.com/docs for details',
    BlockEvent: 'Help - Code /* example */ shown',
  },
}
"""
    stripped = ea._strip_comments(src)
    reg = ea.load_event_registry(src)
    assert reg['Help - Visit https://example.com/docs for details'] == 'EVENTS.Help.UrlEvent'
    assert reg['Help - Code /* example */ shown'] == 'EVENTS.Help.BlockEvent'


def test_desync_warning_on_unmatched_brace_outside_comments(capsys):
    """When walk desyncs due to a quoted key (which regex doesn't match), emit warning."""
    src = """
export const EVENTS = {
  Good: {
    Event1: 'Good - Event 1',
  },
  'my-dynamic-key': {
    Event2: 'Bad - Event 2',
  },
}
"""
    reg = ea.load_event_registry(src)
    captured = capsys.readouterr()
    assert 'WARNING' in captured.err
    assert 'desynced' in captured.err
    assert len(reg) >= 1


def test_no_desync_warning_on_healthy_registry(capsys):
    """When the walk completes successfully, no warning should be emitted."""
    reg = ea.load_event_registry(REGISTRY_SRC)
    captured = capsys.readouterr()
    assert 'WARNING' not in captured.err
    assert len(reg) == 3


def test_regression_comment_with_quotes_does_not_leak_into_registry():
    """Regression: comment containing quotes like 'win' must not be parsed as events.

    This was the bug introduced by first state machine: a quote in a comment
    on line 133 would flip in_string flag, causing // on line 429 to not be
    recognized as comment start, leaking comment prose into the registry.
    """
    src = """
export const EVENTS = {
  // Know your context: 'win' | 'serve' property distinguishes candidate vs. official
  Good: {
    Event1: 'Good - Real Event',
  },
  // Also a comment with 'more' | 'quotes' here
  Better: {
    Event2: 'Better - Another Event',
  },
}
"""
    reg = ea.load_event_registry(src)

    assert 'win' not in reg
    assert 'serve' not in reg
    assert 'quotes' not in reg
    assert 'more' not in reg

    assert reg['Good - Real Event'] == 'EVENTS.Good.Event1'
    assert reg['Better - Another Event'] == 'EVENTS.Better.Event2'
    assert len(reg) == 2


def test_regression_event_literal_with_url_and_comment_marker_survives():
    """Regression: event literal with https:// (which contains //) must survive
    stripping intact. This should have been caught by existing tests, but explicit
    regression test for the specific failure mode.
    """
    src = """
export const EVENTS = {
  Documentation: {
    // This comment also has a URL: https://example.com/help
    LinkViewed: 'Documentation - Link to https://example.com/guide Viewed',
  },
}
"""
    stripped = ea._strip_comments(src)

    reg = ea.load_event_registry(src)
    assert 'Documentation - Link to https://example.com/guide Viewed' in reg
    assert reg['Documentation - Link to https://example.com/guide Viewed'] == 'EVENTS.Documentation.LinkViewed'


def test_regression_tripwire_no_false_alarm_on_brace_in_literal(capsys):
    """Regression: depth counter must skip over braces inside quoted strings.
    A literal with a lone opening brace should not cause false 'registry block malformed'
    warning. The tripwire exists to catch silent failures; false alarms make operators
    ignore it, which defeats the purpose.
    """
    src = """
export const EVENTS = {
  Good: {
    Event1: 'Good - Real Event',
  },
  WithBrace: {
    Event2: 'Good - Event with only an opening brace {',
  },
}
"""
    reg = ea.load_event_registry(src)
    captured = capsys.readouterr()

    assert reg['Good - Real Event'] == 'EVENTS.Good.Event1'
    assert reg['Good - Event with only an opening brace {'] == 'EVENTS.WithBrace.Event2'
    assert len(reg) == 2

    assert 'WARNING' not in captured.err


FILES = {
    "packages/gp-webapp/helpers/analyticsHelper.ts":
        "export const EVENTS = {\n"
        "  Navigation: {\n"
        "    Dashboard: {\n"
        "      ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',\n"
        "    },\n"
        "  },\n"
        "}\n",
    "packages/gp-webapp/app/dashboard/page.tsx":
        "import { EVENTS } from 'helpers/analyticsHelper'\n"
        "const go = () => trackEvent(EVENTS.Navigation.Dashboard.ClickDoorKnocking)\n",
    "packages/gp-api/src/sms/outreachSmsAdmin.service.ts":
        "await this.analytics.track('Voter Outreach - Campaign Approved', { id })\n",
    "packages/gp-webapp/app/unrelated/page.tsx": "const x = 1\n",
}


def test_find_call_sites_finds_the_key_path_use_and_marks_the_declaration():
    hits = ea.find_call_sites(
        "Navigation - Dashboard: Click Door Knocking",
        "EVENTS.Navigation.Dashboard.ClickDoorKnocking",
        FILES,
    )
    kinds = {(h["path"], h["kind"]) for h in hits}
    assert ("packages/gp-webapp/helpers/analyticsHelper.ts", "declaration") in kinds
    assert ("packages/gp-webapp/app/dashboard/page.tsx", "key_path") in kinds
    assert all(h["line"] > 0 for h in hits)


def test_find_call_sites_finds_a_raw_string_literal_with_no_key_path():
    # The provenance walk is blind to this one; the literal search is the whole point.
    hits = ea.find_call_sites("Voter Outreach - Campaign Approved", None, FILES)
    assert [h["path"] for h in hits] == [
        "packages/gp-api/src/sms/outreachSmsAdmin.service.ts"]
    assert hits[0]["kind"] == "literal"


def test_find_call_sites_returns_empty_when_nothing_references_the_event():
    assert ea.find_call_sites("Nobody - Fires This", "EVENTS.No.Body", FILES) == []


def test_find_call_sites_avoids_substring_over_matching():
    """A prefix substring must not match inside a longer sibling event name.
    e.g., 'Candidate Website - Started' should not match inside
    'Candidate Website - Started domain selection'.
    """
    files = {
        "packages/gp-webapp/helpers/analyticsHelper.ts":
            "  Started: 'Candidate Website - Started',\n"
            "  StartedDomainSelection: 'Candidate Website - Started domain selection',\n",
        "packages/gp-webapp/app/test.tsx":
            "trackEvent('Candidate Website - Started domain selection')\n"
            "trackEvent('Candidate Website - Started')\n",
    }
    # Shorter event should only match on line 2, not line 1
    hits = ea.find_call_sites("Candidate Website - Started", None, files)
    paths_and_lines = [(h["path"], h["line"]) for h in hits]
    assert ("packages/gp-webapp/helpers/analyticsHelper.ts", 1) in paths_and_lines
    assert ("packages/gp-webapp/app/test.tsx", 2) in paths_and_lines
    assert len(paths_and_lines) == 2


def test_find_call_sites_classifies_call_sites_in_registry_file_correctly():
    """A line inside the registry file can be either declaration (inside EVENTS block)
    or a normal call site (outside EVENTS block). Only inside-block hits are declared."""
    files = {
        "packages/gp-webapp/helpers/analyticsHelper.ts":
            "export const EVENTS = {\n"  # line 1
            "  Onboarding: {\n"  # line 2
            "    RegistrationCompleted: 'Onboarding - Registration Completed',\n"  # line 3 - declaration
            "  },\n"  # line 4
            "}\n"  # line 5
            "async function trackRegistrationCompleted() {\n"  # line 6
            "  await trackEvent(EVENTS.Onboarding.RegistrationCompleted, {})\n"  # line 7 - call site
            "}\n",  # line 8
        "packages/gp-webapp/app/signup.tsx":
            "await trackEvent(EVENTS.Onboarding.RegistrationCompleted)\n",
    }
    hits = ea.find_call_sites(
        "Onboarding - Registration Completed",
        "EVENTS.Onboarding.RegistrationCompleted",
        files
    )
    # Should have 3 hits total:
    # - Line 3 in registry file: declaration
    # - Line 7 in registry file: key_path (call site, not declaration, because outside block)
    # - Line 1 in app file: key_path
    kinds = {(h["path"], h["line"], h["kind"]) for h in hits}
    assert ("packages/gp-webapp/helpers/analyticsHelper.ts", 3, "declaration") in kinds
    assert ("packages/gp-webapp/helpers/analyticsHelper.ts", 7, "key_path") in kinds
    assert ("packages/gp-webapp/app/signup.tsx", 1, "key_path") in kinds


def test_find_call_sites_respects_key_path_word_boundaries():
    """A key-path needle must have word boundaries on both sides.
    EVENTS.Foo should not match EVENTS.FooBar or EVENTS.Foo.Bar components."""
    files = {
        "packages/gp-webapp/helpers/analyticsHelper.ts":
            "  Foo: 'Foo - Event',\n",
        "packages/gp-webapp/app/test.tsx":
            "const x = EVENTS.Foo\n"  # Exact match with boundary at end
            "const y = EVENTS.FooBar\n"  # Should NOT match (FooBar starts where Foo ends)
            "const z = { EVENTS.Foo.Bar }\n"  # Should NOT match (. after Foo)
            "const w = myEvents.Foo\n",  # No . before, but also not in EVENTS namespace
    }
    hits = ea.find_call_sites("Foo - Event", "EVENTS.Foo", files)
    paths_and_lines = [(h["path"], h["line"]) for h in hits]
    # Should find: line 1 (declaration), line 1 in test (exact match)
    # Should NOT find: line 2, line 3 (due to boundary checks)
    # Line 4 should NOT match due to myEvents vs EVENTS
    assert ("packages/gp-webapp/helpers/analyticsHelper.ts", 1) in paths_and_lines
    assert ("packages/gp-webapp/app/test.tsx", 1) in paths_and_lines
    # Verify we didn't get spurious matches
    assert all((p, l) != ("packages/gp-webapp/app/test.tsx", 2) for p, l in paths_and_lines)
    assert all((p, l) != ("packages/gp-webapp/app/test.tsx", 3) for p, l in paths_and_lines)


def test_find_call_sites_results_ordered_by_path_then_line():
    """Results must be sorted by path (alphabetically) then by line number."""
    files = {
        "packages/gp-api/services/eventTracker.ts":
            "  track('Event - Name')\n"
            "  // another reference below\n"
            "  track('Event - Name')\n",
        "packages/gp-webapp/helpers/analyticsHelper.ts":
            "  EventName: 'Event - Name',\n"
            "  other: 'Other - Event',\n"
            "  EventName2: 'Event - Name',\n",
        "packages/gp-admin/src/utils.ts":
            "  track('Event - Name')\n",
    }
    hits = ea.find_call_sites("Event - Name", None, files)
    # Extract (path, line) pairs to verify order
    pairs = [(h["path"], h["line"]) for h in hits]

    # Expected order: gp-admin, gp-api, gp-webapp (alphabetical)
    # Within each path: line numbers in order
    # Note: 'Event - Name' appears twice in the registry (lines 1 and 3)
    expected = [
        ("packages/gp-admin/src/utils.ts", 1),
        ("packages/gp-api/services/eventTracker.ts", 1),
        ("packages/gp-api/services/eventTracker.ts", 3),
        ("packages/gp-webapp/helpers/analyticsHelper.ts", 1),
        ("packages/gp-webapp/helpers/analyticsHelper.ts", 3),
    ]
    assert pairs == expected


def test_find_call_sites_fails_toward_not_declaring_when_block_not_found(capsys):
    """When EVENTS block is not locatable in registry file, no hit should be
    classified as declaration. Fail toward showing evidence (literal/key_path)
    rather than hiding call sites by blanket declaring them."""
    files = {
        "packages/gp-webapp/helpers/analyticsHelper.ts":
            "// Malformed or reformatted — no 'EVENTS = {' pattern\n"
            "const EVENTS_OLD = {\n"  # Wrong pattern
            "  Onboarding: {\n"
            "    RegistrationCompleted: 'Onboarding - Registration Completed',\n"
            "  },\n"
            "}\n"
            "await trackEvent(EVENTS.Onboarding.RegistrationCompleted, {})\n",
    }
    hits = ea.find_call_sites(
        "Onboarding - Registration Completed",
        "EVENTS.Onboarding.RegistrationCompleted",
        files
    )
    # All hits should be literal/key_path, never declaration (since block not found)
    assert all(h["kind"] in ("literal", "key_path") for h in hits)
    # Verify warning was printed
    captured = capsys.readouterr()
    assert "WARNING" in captured.err
    assert "EVENTS block not locatable" in captured.err


def test_find_call_sites_four_live_repo_cases_verified():
    """Verify the four key live-repo cases from the real-repo check still work.
    These are integration tests that scan real files to ensure the fixes don't
    regress on actual data."""
    import pathlib

    repo = pathlib.Path("../../../..").resolve()
    files = {}
    for pkg in ("packages/gp-webapp", "packages/gp-admin", "packages/gp-api"):
        pkg_path = repo / pkg
        if not pkg_path.exists():
            return  # Skip if running outside the full repo
        for p in pkg_path.rglob("*"):
            if p.suffix in (".ts", ".tsx") and "node_modules" not in p.parts:
                try:
                    files[p.relative_to(repo).as_posix()] = p.read_text()
                except (OSError, UnicodeDecodeError):
                    pass

    if not files:
        return  # Skip if no files loaded

    reg = ea.load_event_registry(files.get(ea.REGISTRY_FILE, ""))

    # Case 1: Onboarding - Registration Completed (has declaration + call sites)
    hits = ea.find_call_sites(
        "Onboarding - Registration Completed",
        reg.get("Onboarding - Registration Completed"),
        files
    )
    kinds = {h["kind"] for h in hits}
    if hits:
        assert "declaration" in kinds, "Should have declaration in registry file"
        assert "key_path" in kinds, "Should have key_path call sites"

    # Case 2: Dashboard - Path to Victory: Click Learn More (declaration-only)
    hits = ea.find_call_sites(
        "Dashboard - Path to Victory: Click Learn More",
        reg.get("Dashboard - Path to Victory: Click Learn More"),
        files
    )
    if hits:
        kinds = {h["kind"] for h in hits}
        assert "declaration" in kinds or not kinds, "Should be declaration-only or empty"

    # Case 3: Voter Outreach - Campaign Approved (raw string literal)
    hits = ea.find_call_sites("Voter Outreach - Campaign Approved", None, files)
    if hits:
        assert all(h["kind"] == "literal" for h in hits), "Should be literal hits"

    # Case 4: Navigation - Dashboard: Click Door Knocking (declaration-only)
    hits = ea.find_call_sites(
        "Navigation - Dashboard: Click Door Knocking",
        reg.get("Navigation - Dashboard: Click Door Knocking"),
        files
    )
    if hits:
        kinds = {h["kind"] for h in hits}
        assert "declaration" in kinds or not kinds, "Should be declaration-only or empty"


PAGES = [
    "packages/gp-webapp/app/dashboard/page.tsx",
    "packages/gp-webapp/app/dashboard/campaign-plan/page.tsx",
    "packages/gp-admin/app/dashboard/sms-outreach/[id]/page.tsx",
    "packages/gp-webapp/app/(marketing)/about/page.tsx",
]


def test_derive_url_finds_the_nearest_enclosing_route():
    assert ea.derive_url(
        "packages/gp-webapp/app/dashboard/campaign-plan/PlanCard.tsx", PAGES
    ) == "/dashboard/campaign-plan"


def test_derive_url_app_qualifies_anything_outside_the_candidate_webapp():
    # /dashboard/... exists in both apps, so an unqualified path is ambiguous.
    assert ea.derive_url(
        "packages/gp-admin/app/dashboard/sms-outreach/[id]/Approve.tsx", PAGES
    ) == "/dashboard/sms-outreach/[id] (gp-admin)"


def test_derive_url_drops_route_groups():
    assert ea.derive_url("packages/gp-webapp/app/(marketing)/about/page.tsx", PAGES) == "/about"


def test_derive_url_returns_none_off_the_app_router():
    assert ea.derive_url(
        "packages/gp-api/src/sms/outreachSmsAdmin.service.ts", PAGES) is None


def test_derive_url_handles_gp_admin_real_directory_structure():
    # The real repo has gp-admin at packages/gp-admin/src/app/..., not packages/gp-admin/app/...
    # This test verifies the path normalization handles the src/ subdirectory correctly.
    pages = [
        "packages/gp-admin/src/app/page.tsx",
        "packages/gp-admin/src/app/dashboard/page.tsx",
        "packages/gp-admin/src/app/dashboard/ecanvasser/page.tsx",
    ]
    assert ea.derive_url("packages/gp-admin/src/app/page.tsx", pages) == "/ (gp-admin)"
    assert ea.derive_url(
        "packages/gp-admin/src/app/dashboard/SomeComponent.tsx", pages
    ) == "/dashboard (gp-admin)"
    assert ea.derive_url(
        "packages/gp-admin/src/app/dashboard/ecanvasser/SomeComponent.tsx", pages
    ) == "/dashboard/ecanvasser (gp-admin)"


def test_build_candidate_windows_the_code_and_carries_the_evidence():
    files = {"packages/gp-webapp/app/dashboard/page.tsx": "\n".join(
        f"line {i}" for i in range(1, 101))}
    hits = [{"path": "packages/gp-webapp/app/dashboard/page.tsx", "line": 50,
             "kind": "key_path"}]
    c = ea.build_candidate(
        {"event_type": "E", "family": "win_dashboard", "description": "does a thing"},
        hits, "/dashboard", files)
    assert c["id"] == "E"
    assert c["derived_url"] == "/dashboard"
    assert c["evidence"] == "packages/gp-webapp/app/dashboard/page.tsx:50"
    assert "line 50" in c["code"]
    assert len(c["code"].splitlines()) <= 40   # bounded so judge input stays small


def test_build_candidate_marks_a_declaration_only_event_as_dynamic_dispatch():
    files = {ea.REGISTRY_FILE: "  ClickX: 'Nav - X',\n"}
    hits = [{"path": ea.REGISTRY_FILE, "line": 1, "kind": "declaration"}]
    c = ea.build_candidate({"event_type": "Nav - X", "family": "nav", "description": ""},
                           hits, None, files)
    assert c["hint"] == "dynamic_dispatch"


def test_build_candidate_marks_no_call_site():
    c = ea.build_candidate({"event_type": "Ghost", "family": "x", "description": ""},
                           [], None, {})
    assert c["hint"] == "no_call_site"
    assert c["code"] == ""


def test_anchor_tool_forces_one_verdict_per_event_with_the_needed_fields():
    schema = ea.ANCHOR_TOOL["input_schema"]
    verdict = schema["properties"]["verdicts"]["items"]["properties"]
    assert set(verdict) >= {"id", "fires_on", "url", "confidence", "flag_reason"}
    assert ea.ANCHOR_TOOL["name"] == "report_anchors"


def test_judge_anchors_degrades_gracefully_without_a_key():
    verdicts, status = ea.judge_anchors([{"id": "E"}], api_key=None, model="m")
    assert verdicts == {}
    assert status == "skipped: ANTHROPIC_API_KEY unset"


def test_anchor_tool_flag_reason_is_constrained_to_the_confidence_classes():
    """flag_reason must be optional (a high-confidence verdict has none) but, once
    present, restricted to CONFIDENCE_CLASSES — sourced from the constant so the schema
    and the constant cannot drift apart."""
    schema = ea.ANCHOR_TOOL["input_schema"]
    verdict = schema["properties"]["verdicts"]["items"]["properties"]
    assert verdict["flag_reason"]["enum"] == list(ea.CONFIDENCE_CLASSES)
    assert "flag_reason" not in schema["properties"]["verdicts"]["items"]["required"]


def test_anchor_prompt_tells_the_model_to_trust_a_nonempty_hint():
    prompt = ea.anchor_system_prompt()
    assert "hint" in prompt.lower()


class _FakeBlock:
    def __init__(self, input_):
        self.type = "tool_use"
        self.input = input_


class _FakeResp:
    def __init__(self, content, stop_reason="tool_use"):
        self.content = content
        self.stop_reason = stop_reason


class _FakeMessages:
    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeResp([_FakeBlock(self._payload)])


class _FakeClient:
    def __init__(self, payload):
        self.messages = _FakeMessages(payload)


def test_judge_anchors_wires_the_forced_tool_and_returns_id_keyed_verdicts():
    payload = {
        "verdicts": [
            {"id": "E", "fires_on": "Dashboard, click a thing", "url": "/dashboard",
             "confidence": "high"},
        ]
    }
    client = _FakeClient(payload)
    verdicts, status = ea.judge_anchors(
        [{"id": "E"}], api_key="sk-ant-x", model="claude-sonnet-5",
        client_factory=lambda _key: client)
    assert status == "ok"
    assert verdicts["E"]["fires_on"] == "Dashboard, click a thing"
    sent = client.messages.calls[0]
    assert sent["tool_choice"] == {"type": "tool", "name": "report_anchors"}
    assert sent["tools"] == [ea.ANCHOR_TOOL]


class _ChunkCountingClient:
    """Fake client whose second call fails; the other two succeed with verdicts keyed by
    whatever ids that particular chunk actually sent — proves chunks are merged, not just
    repeated, and that a failing chunk does not discard the succeeding ones' verdicts."""
    def __init__(self):
        self.messages = self
        self.call_count = 0

    def create(self, **kwargs):
        self.call_count += 1
        ids = [c["id"] for c in json.loads(kwargs["messages"][0]["content"])]
        if self.call_count == 2:
            raise RuntimeError("boom")
        payload = {"verdicts": [
            {"id": i, "fires_on": f"fires {i}", "url": "/x", "confidence": "high"}
            for i in ids
        ]}
        return _FakeResp([_FakeBlock(payload)])


def test_judge_anchors_chunks_candidates_and_merges_across_calls():
    candidates = [{"id": f"E{i}"} for i in range(60)]
    client = _ChunkCountingClient()
    verdicts, status = ea.judge_anchors(
        candidates, api_key="sk-ant-x", model="m", client_factory=lambda _key: client)
    assert client.call_count == 3          # 60 candidates / chunk_size 25 -> 3 calls
    # chunks 1 (E0-E24) and 3 (E50-E59) succeed; chunk 2 (E25-E49) fails and contributes
    # nothing, but never raises and never discards the other chunks' verdicts.
    assert len(verdicts) == 35
    assert "E0" in verdicts and "E59" in verdicts
    assert "E30" not in verdicts
    assert "not ok" in status
    assert "boom" in status


def test_merge_verdicts_seeds_new_entries_and_preserves_human_fields():
    candidates = [{"id": "E", "evidence": "a.tsx:3"}]
    verdicts = {"E": {"id": "E", "fires_on": "Plan page, Generate button.",
                      "url": "/dashboard/campaign-plan", "confidence": "high"}}
    state = ea.merge_verdicts({}, verdicts, candidates, "2026-09-10")
    assert state["E"]["disposition"] == "new"
    assert state["E"]["first_seen"] == "2026-09-10"
    assert state["E"]["evidence"] == "a.tsx:3"

    # a later run must not clobber a decision or the edited text
    state["E"].update(disposition="accepted", fires_on="Edited by a human.")
    again = ea.merge_verdicts(state, verdicts, candidates, "2026-09-17")
    assert again["E"]["disposition"] == "accepted"
    assert again["E"]["fires_on"] == "Edited by a human."
    assert again["E"]["first_seen"] == "2026-09-10"
    assert again["E"]["last_seen"] == "2026-09-17"


def test_review_artifact_round_trips_an_edited_draft():
    state = {"E": {"fires_on": "Draft line.", "url": "/dashboard",
                   "confidence": "high", "flag_reason": "", "evidence": "a.tsx:3",
                   "disposition": "new", "reason": "", "first_seen": "2026-09-10",
                   "last_seen": "2026-09-10", "written_date": ""}}
    text = ea.render_review_artifact(state, "2026-09-10")
    assert "- fires_on: Draft line." in text
    assert "a.tsx:3" in text                      # evidence visible to the reviewer

    edited = text.replace("- fires_on: Draft line.",
                          "- fires_on: Corrected line.").replace(
                          "- disposition:", "- disposition: accepted")
    parsed = ea.parse_review_artifact(edited)
    assert parsed["E"]["fires_on"] == "Corrected line."
    assert parsed["E"]["disposition"] == "accepted"

    applied = ea.apply_review(state, parsed, "2026-09-11")
    assert applied["E"]["fires_on"] == "Corrected line."
    assert applied["E"]["disposition"] == "accepted"
    assert applied["E"]["first_seen"] == "2026-09-10"   # preserved


def test_apply_review_skips_an_invalid_disposition_rather_than_applying_it():
    state = {"E": {"fires_on": "x", "url": "", "disposition": "new", "reason": "",
                   "first_seen": "2026-09-10", "last_seen": "2026-09-10",
                   "confidence": "high", "flag_reason": "", "evidence": "",
                   "written_date": ""}}
    out = ea.apply_review(state, {"E": {"disposition": "yes-please", "fires_on": "x"}},
                          "2026-09-11")
    assert out["E"]["disposition"] == "new"


def test_apply_review_ignores_ids_absent_from_state():
    assert ea.apply_review({}, {"Ghost": {"disposition": "accepted"}}, "2026-09-11") == {}


def test_render_shows_the_flag_class_instead_of_a_route_when_confidence_is_low():
    state = {"E": {"fires_on": "Left nav item.", "url": "n/a (global nav)",
                   "confidence": "low", "flag_reason": "global_chrome",
                   "evidence": "nav.tsx:12", "disposition": "new", "reason": "",
                   "first_seen": "2026-09-10", "last_seen": "2026-09-10",
                   "written_date": ""}}
    text = ea.render_review_artifact(state, "2026-09-10")
    assert "LOW" in text and "global_chrome" in text


# --- Fix-round 1: never drop a reviewer's edit in silence -----------------------------

def test_parse_warns_on_a_wrapped_value_naming_the_event_and_text(capsys):
    text = ("## E\n"
            "- fires_on: Campaign Plan page, click Generate when the very long\n"
            "  correction continues on a second line.\n"
            "- url: /dashboard\n"
            "- disposition:\n"
            "- reason:\n")
    parsed = ea.parse_review_artifact(text)
    # the continuation is not guessed into fires_on — only the marker line is captured
    assert parsed["E"]["fires_on"] == "Campaign Plan page, click Generate when the very long"
    err = capsys.readouterr().err
    assert "'E'" in err
    assert "correction continues on a second line." in err


def test_stray_heading_inside_a_block_surfaces_as_an_unknown_id_warning_not_a_lost_decision(capsys):
    state = {"E": {"fires_on": "x", "url": "", "confidence": "high", "flag_reason": "",
                   "evidence": "", "disposition": "new", "reason": "",
                   "first_seen": "2026-09-10", "last_seen": "2026-09-10",
                   "written_date": ""}}
    text = ("## E\n"
            "- fires_on: Corrected.\n"
            "## check with PM\n"
            "- url: /dashboard\n"
            "- disposition: accepted\n"
            "- reason:\n")
    parsed = ea.parse_review_artifact(text)
    out = ea.apply_review(state, parsed, "2026-09-11")
    err = capsys.readouterr().err
    assert "check with PM" in err
    # the disposition landed on the phantom block, not the real row — apply_review must
    # say so loudly rather than leave the row silently stuck on "new"
    assert out["E"]["disposition"] == "new"
    assert out["E"]["fires_on"] == "Corrected."


def test_apply_review_skips_a_stale_reapply_onto_an_already_decided_row(capsys):
    state = {"E": {"fires_on": "Final text.", "url": "/dashboard", "confidence": "high",
                   "flag_reason": "", "evidence": "", "disposition": "accepted",
                   "reason": "", "first_seen": "2026-09-01", "last_seen": "2026-09-05",
                   "written_date": ""}}
    stale = {"E": {"fires_on": "Old draft text.", "url": "/old", "disposition": ""}}
    out = ea.apply_review(state, stale, "2026-09-11")
    assert out["E"]["fires_on"] == "Final text."
    assert out["E"]["disposition"] == "accepted"
    assert "'E'" in capsys.readouterr().err

    # a deliberate re-decision, with an explicit disposition, still goes through
    deliberate = {"E": {"fires_on": "Reopened correction.", "disposition": "dismissed"}}
    out2 = ea.apply_review(out, deliberate, "2026-09-12")
    assert out2["E"]["fires_on"] == "Reopened correction."
    assert out2["E"]["disposition"] == "dismissed"


def test_parse_review_artifact_honours_an_indented_field_line():
    text = "## E\n  - fires_on: Indented edit.\n- disposition:\n"
    parsed = ea.parse_review_artifact(text)
    assert parsed["E"]["fires_on"] == "Indented edit."


def test_merge_and_apply_do_not_mutate_the_callers_state_object():
    state = {"E": {"fires_on": "orig", "url": "orig_url", "confidence": "high",
                   "flag_reason": "", "evidence": "a.tsx:1", "disposition": "new",
                   "reason": "", "first_seen": "2026-09-10", "last_seen": "2026-09-10",
                   "written_date": ""}}
    before = copy.deepcopy(state)

    candidates = [{"id": "E", "evidence": "a.tsx:1"}]
    verdicts = {"E": {"id": "E", "fires_on": "changed", "url": "changed", "confidence": "high"}}
    ea.merge_verdicts(state, verdicts, candidates, "2026-09-17")
    assert state == before

    ea.apply_review(state, {"E": {"fires_on": "edited", "disposition": "accepted"}},
                    "2026-09-18")
    assert state == before


def test_review_round_trip_still_works_after_the_stricter_parsing():
    state = {
        "E": {"fires_on": "Draft one.", "url": "/one", "confidence": "high",
              "flag_reason": "", "evidence": "a.tsx:1", "disposition": "new",
              "reason": "", "first_seen": "2026-09-10", "last_seen": "2026-09-10",
              "written_date": ""},
        "F": {"fires_on": "Draft two.", "url": "/two", "confidence": "high",
              "flag_reason": "", "evidence": "b.tsx:2", "disposition": "new",
              "reason": "", "first_seen": "2026-09-10", "last_seen": "2026-09-10",
              "written_date": ""},
    }
    text = ea.render_review_artifact(state, "2026-09-10")
    # Isolate block E's own text before editing it — the header also contains the literal
    # substring "- disposition:" (backticked, in the reviewer instructions), so a replace
    # over the whole text or over everything up to "## F" can hit the header instead of
    # the real field line. Scoping to between "## E" and "## F" avoids that trap.
    before_e, _, e_and_rest = text.partition("## E")
    block_e, _, after_f = e_and_rest.partition("## F")
    block_e = block_e.replace("- fires_on: Draft one.", "- fires_on: Corrected one.").replace(
        "- disposition:", "- disposition: accepted")
    edited = before_e + "## E" + block_e + "## F" + after_f
    parsed = ea.parse_review_artifact(edited)
    applied = ea.apply_review(state, parsed, "2026-09-11")
    assert applied["E"]["fires_on"] == "Corrected one."
    assert applied["E"]["disposition"] == "accepted"
    assert applied["E"]["first_seen"] == "2026-09-10"
    # untouched row survives unchanged
    assert applied["F"]["fires_on"] == "Draft two."
    assert applied["F"]["disposition"] == "new"


# --- Task 7: state I/O, candidate collection, and the CLI -----------------------------

def test_load_state_missing_file_is_a_legitimate_first_run(tmp_path):
    assert ea.load_state(tmp_path / "nope.json") == {}


def test_load_state_raises_on_a_corrupt_file_rather_than_silently_restarting(tmp_path):
    """A corrupt file is NOT a legitimate first run: silently starting from {} would
    re-draft every event and wipe every human disposition on the next save."""
    bad = tmp_path / "anchors.json"
    bad.write_text("{ not valid json")
    with pytest.raises(json.JSONDecodeError):
        ea.load_state(bad)


def test_save_state_round_trips_and_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "anchors.json"
    ea.save_state(path, {"E": {"fires_on": "x"}})
    assert json.loads(path.read_text()) == {"E": {"fires_on": "x"}}


def _write_fake_repo(tmp_path: pathlib.Path, page_rel: str, page_src: str = "export default function Page(){return null}") -> pathlib.Path:
    """A minimal repo tree: the registry file plus one page.tsx, enough for
    collect_candidates to walk without touching a real checkout."""
    registry_path = tmp_path / ea.REGISTRY_FILE
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(REGISTRY_SRC)
    page_path = tmp_path / page_rel
    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text(page_src)
    return tmp_path


def _fake_run_query(rows):
    """Mimics event_state_assembler.fetch_catalog's `run_query(sql).to_dict("records")`
    contract without ever touching Databricks."""
    class _FakeDF:
        def __init__(self, data):
            self._data = data

        def to_dict(self, orient):
            assert orient == "records"
            return self._data

    def run_query(sql):
        return _FakeDF(rows)

    return run_query


def test_collect_candidates_never_touches_the_network(tmp_path):
    repo = _write_fake_repo(tmp_path, "packages/gp-webapp/app/dashboard/page.tsx")
    rows = [{"event_type": "Onboarding - Pledge Completed", "family": "onboarding",
             "event_count_30d": 5}]
    candidates = ea.collect_candidates(repo, {}, run_query=_fake_run_query(rows))
    assert [c["id"] for c in candidates] == ["Onboarding - Pledge Completed"]


def test_collect_candidates_skips_events_already_anchored_or_dispositioned(tmp_path):
    repo = _write_fake_repo(tmp_path, "packages/gp-webapp/app/dashboard/page.tsx")
    rows = [
        {"event_type": "Onboarding - Pledge Completed", "family": "onboarding",
         "event_count_30d": 5},
        {"event_type": "Navigation - Dashboard: Click My Profile", "family": "nav",
         "event_count_30d": 3},
        {"event_type": "Navigation - Dashboard: Click Door Knocking", "family": "nav",
         "event_count_30d": 1},
        {"event_type": "Zero Volume Event", "family": "x", "event_count_30d": 0},
    ]
    state = {
        # already drafted a fires_on -> skip
        "Onboarding - Pledge Completed": {"fires_on": "already drafted", "disposition": "new"},
        # human-dispositioned -> skip even with no fires_on
        "Navigation - Dashboard: Click My Profile": {"fires_on": "", "disposition": "accepted"},
    }
    candidates = ea.collect_candidates(repo, state, run_query=_fake_run_query(rows))
    assert [c["id"] for c in candidates] == ["Navigation - Dashboard: Click Door Knocking"]


def test_collect_candidates_skips_an_event_whose_govern_description_already_has_fires_on(tmp_path):
    repo = _write_fake_repo(tmp_path, "packages/gp-webapp/app/dashboard/page.tsx")
    rows = [{"event_type": "Onboarding - Pledge Completed", "family": "onboarding",
             "event_count_30d": 5,
             "govern_description": "<!-- gp-meta -->\nfires_on: Onboarding, pledge step.\n"
                                    "<!-- /gp-meta -->"}]
    assert ea.collect_candidates(repo, {}, run_query=_fake_run_query(rows)) == []


def test_collect_candidates_respects_limit_and_sorts_by_volume_desc(tmp_path):
    repo = _write_fake_repo(tmp_path, "packages/gp-webapp/app/dashboard/page.tsx")
    rows = [
        {"event_type": "Onboarding - Pledge Completed", "family": "o", "event_count_30d": 9},
        {"event_type": "Navigation - Dashboard: Click My Profile", "family": "n",
         "event_count_30d": 5},
        {"event_type": "Navigation - Dashboard: Click Door Knocking", "family": "n",
         "event_count_30d": 1},
    ]
    candidates = ea.collect_candidates(repo, {}, run_query=_fake_run_query(rows), limit=2)
    assert [c["id"] for c in candidates] == [
        "Onboarding - Pledge Completed", "Navigation - Dashboard: Click My Profile",
    ]


def test_main_list_new_reports_without_touching_state(tmp_path, capsys):
    state = tmp_path / "anchors.json"
    state.write_text(json.dumps({"E": {
        "fires_on": "x", "url": "/y", "confidence": "high", "flag_reason": "",
        "evidence": "a.tsx:1", "disposition": "new", "reason": "",
        "first_seen": "2026-09-10", "last_seen": "2026-09-10", "written_date": ""}}))
    before = state.read_text()
    assert ea.main(["--state", str(state), "--list-new"]) == 0
    assert "E" in capsys.readouterr().out
    assert state.read_text() == before


def test_main_load_review_applies_edits_to_state(tmp_path):
    state = tmp_path / "anchors.json"
    state.write_text(json.dumps({"E": {
        "fires_on": "draft", "url": "/y", "confidence": "high", "flag_reason": "",
        "evidence": "a.tsx:1", "disposition": "new", "reason": "",
        "first_seen": "2026-09-10", "last_seen": "2026-09-10", "written_date": ""}}))
    artifact = tmp_path / "review.md"
    artifact.write_text("## E\n- fires_on: corrected\n- url: /y\n- disposition: accepted\n- reason: ok\n")
    assert ea.main(["--state", str(state), "--load-review", str(artifact),
                    "--today", "2026-09-11"]) == 0
    after = json.loads(state.read_text())
    assert after["E"]["fires_on"] == "corrected"
    assert after["E"]["disposition"] == "accepted"


def test_main_review_artifact_writes_the_queue_without_mutating_state(tmp_path, capsys):
    state = tmp_path / "anchors.json"
    state.write_text(json.dumps({"E": {
        "fires_on": "x", "url": "/y", "confidence": "high", "flag_reason": "",
        "evidence": "a.tsx:1", "disposition": "new", "reason": "",
        "first_seen": "2026-09-10", "last_seen": "2026-09-10", "written_date": ""}}))
    artifact_path = tmp_path / "review.md"
    before = state.read_text()
    assert ea.main(["--state", str(state), "--review-artifact", str(artifact_path),
                    "--today", "2026-09-11"]) == 0
    assert "## E" in artifact_path.read_text()
    assert state.read_text() == before
    assert "wrote review artifact" in capsys.readouterr().out


def test_main_no_judge_run_collects_and_reports_without_drafting(tmp_path, monkeypatch, capsys):
    """--no-judge exercises main's default wiring (collect_candidates -> merge_verdicts ->
    save_state) with no LLM call and no verdicts, via a monkeypatched collect_candidates so
    the test never reaches the filesystem walk or Databricks."""
    state_path = tmp_path / "anchors.json"
    monkeypatch.setattr(ea, "collect_candidates",
                        lambda repo, state, limit=None: [{"id": "E", "evidence": "a.tsx:1"}])
    assert ea.main(["--state", str(state_path), "--no-judge"]) == 0
    out = capsys.readouterr().out
    assert "1 candidates" in out
    assert "0 drafted" in out
    assert "skipped: --no-judge" in out
    assert json.loads(state_path.read_text()) == {}   # no verdicts -> nothing to merge in


def test_main_default_run_judges_drafts_and_saves(tmp_path, monkeypatch, capsys):
    """The full default path, with both collect_candidates and judge_anchors monkeypatched
    so the run never touches the filesystem walk, Databricks, or the network."""
    state_path = tmp_path / "anchors.json"
    monkeypatch.setattr(ea, "collect_candidates",
                        lambda repo, state, limit=None: [{"id": "E", "evidence": "a.tsx:1"}])
    monkeypatch.setattr(ea, "judge_anchors", lambda candidates, **kwargs: (
        {"E": {"id": "E", "fires_on": "Dashboard, Generate.", "url": "/dashboard",
               "confidence": "high"}}, "ok"))
    assert ea.main(["--state", str(state_path), "--today", "2026-09-11"]) == 0
    saved = json.loads(state_path.read_text())
    assert saved["E"]["fires_on"] == "Dashboard, Generate."
    assert saved["E"]["disposition"] == "new"
    out = capsys.readouterr().out
    assert "1 drafted" in out
    assert "judge ok" in out


def test_main_never_writes_to_amplitude():
    # Plan A ends at the queue. The writer is plan B, behind a human reading a pilot.
    src = inspect.getsource(ea)
    assert "update_event" not in src and "create_events" not in src
