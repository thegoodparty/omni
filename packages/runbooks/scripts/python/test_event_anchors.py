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
        "  ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',\n",
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
