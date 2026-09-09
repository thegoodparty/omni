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
