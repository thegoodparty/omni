"""Push analytics event-lifecycle updates to Slack (DATA-2057).

A third sink alongside ``event_state_gsheet.py``. The Sheet + ClickUp page are *pull*
surfaces holding full current state; this is the *push* stream. Two independent sources
feed one dedicated channel:

- **Source A — real-time metadata changes**: fired from the ``event-metadata`` skill
  after a confirmed Amplitude write (the single governance-write choke point, so it
  catches both the ``instrument-analytics-event`` PR path and manual dev-feedback runs).
  ``build_metadata_blocks`` + the ``notify-metadata`` CLI.
- **Source B — health digest**: fired inline from ``analytics_event_health.main()`` —
  a delta-led parent message plus a threaded detail reply, quiet-gated by ``should_post``.

Credential model: a **shared Slack bot token** (``SLACK_APP_BOT_TOKEN``) + ``chat.postMessage``,
never a personal OAuth token (the recurring Sheets pain point). ``chat.postMessage`` (not an
incoming webhook) is required because the digest reply threads under the parent via
``thread_ts`` — webhooks cannot thread. Posts go out via ``requests`` (already a dep).

The pure block builders (``build_metadata_blocks``, ``build_digest_blocks``) and the
``should_post`` gate have no IO and are unit-tested with fixtures; the poster takes an
injectable ``transport`` so the network call is faked in tests.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Callable

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SLACK_POST_URL = "https://slack.com/api/chat.postMessage"
TOKEN_ENV = "SLACK_APP_BOT_TOKEN"                       # gp-api's env-var name; dedicated app's token
CHANNEL_ENV = "SLACK_EVENT_LIFECYCLE_CHANNEL_ID"

# emoji + headline per Source A change type
_HEADLINES = {
    "created": ("🆕", "New analytics event instrumented"),
    "retired": ("♻️", "Event retired"),
    "superseded": ("🔁", "Event superseded"),
    "updated": ("✏️", "Event metadata updated"),
}
# Cap how many transitions the digest parent spells out before summarizing (the first
# run flags everything, which would otherwise dump the whole catalog into the channel).
TRANSITION_CAP = 15
# Cap the parent's yellow tier; red is uncapped (small by construction) and fyi is a count.
YELLOW_CAP = 10
MENTION_ENV = "SLACK_EVENT_ALERT_MENTION"
# Slack caps a single block's text object at 3000 chars. Red items render at ~10 lines
# apiece (event, OKR, headline, action), so a handful of them can approach that limit in
# one section; chunk into multiple section blocks — blocks are cheap, the limit is per
# text object, not per message.
RED_CHUNK_SIZE = 5
# Yellow lines are single-line (event + capped headline), so more fit per block.
YELLOW_CHUNK_SIZE = 8


def sheet_url() -> str | None:
    """The event-state sheet link for post footers. Prefer an explicit
    ``GP_EVENT_STATE_SHEET_URL`` override, else derive it from ``GP_EVENT_STATE_SHEET_ID``
    (already set for the DATA-2052 gSheet sink, so no new config is needed). None when
    neither is set — the post then just omits the link."""
    explicit = os.environ.get("GP_EVENT_STATE_SHEET_URL")
    if explicit:
        return explicit
    sheet_id = os.environ.get("GP_EVENT_STATE_SHEET_ID")
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit" if sheet_id else None


# --- Block Kit helpers (pure) -------------------------------------------------


def _header(text: str) -> dict:
    # header blocks are plain_text; the emoji renders because emoji:true is the default
    return {"type": "header", "text": {"type": "plain_text", "text": text, "emoji": True}}


def _section(mrkdwn: str) -> dict:
    return {"type": "section", "text": {"type": "mrkdwn", "text": mrkdwn}}


def _context(mrkdwn: str) -> dict:
    return {"type": "context", "elements": [{"type": "mrkdwn", "text": mrkdwn}]}


def build_metadata_blocks(change: dict) -> list[dict]:
    """Block Kit blocks for a Source A (real-time metadata change) post.

    ``change`` carries: ``event``, ``change_type`` (created|retired|superseded|updated),
    ``status``, ``product``, ``family``, ``purpose``, ``source`` (PR # or "manual"),
    ``author``, ``supersession``, ``sheet_url``, and (for updates) ``changed`` — the list
    of fields that changed. Only ``event`` and ``change_type`` are required; the rest
    render when present.
    """
    emoji, label = _HEADLINES.get(change["change_type"], ("📝", "Event change"))
    blocks: list[dict] = [_header(f"{emoji} {label}")]

    # headline line: event name, then the status · product · family descriptor
    descriptor_bits = [b for b in (
        change.get("status"),
        (change.get("product") or "").removeprefix("product:").title() or None,
        f"family: {change['family']}" if change.get("family") else None,
    ) if b]
    headline = f"*{change['event']}*"
    if descriptor_bits:
        headline += "\n" + " · ".join(descriptor_bits)
    blocks.append(_section(headline))

    if change.get("change_type") == "updated" and change.get("changed"):
        blocks.append(_section(f"Changed: {', '.join(change['changed'])}"))
    if change.get("purpose"):
        blocks.append(_section(f"Purpose: {change['purpose']}"))
    sup = (change.get("supersession") or "").strip()
    if sup and sup.lower() != "original":
        blocks.append(_section(f"→ {sup}"))

    footer_bits = [b for b in (change.get("source"),
                               f"@{change['author']}" if change.get("author") else None) if b]
    if change.get("sheet_url"):
        footer_bits.append(f"<{change['sheet_url']}|📄 Event-state sheet>")
    if footer_bits:
        blocks.append(_context(" · ".join(footer_bits)))
    return blocks


def _current_status_map(result: dict) -> dict[str, str]:
    return {r["event_type"]: r["status"] for r in result.get("flagged", [])}


def _new_anomalies(result: dict, prior_anomalous: set[str] | None = None) -> list[dict]:
    """Flagged events carrying a firing-volume anomaly that was NOT present last run — the
    noisy signal the quiet gate must never suppress. ``prior_anomalous`` is the set of
    event_types that were anomalous on the previous run. This catches both a newly flagged
    anomalous event and a still-flagged event that *develops* an anomaly, while a persistent
    anomaly (already reported on a prior run) stays quiet — so the digest doesn't re-post it
    every run.

    ``None`` means we have no prior-anomaly knowledge at all — no state file, a corrupt one,
    or one written before this key existed (the first ``--slack`` run on an established
    deployment). We can't tell a new anomaly from a weeks-old one, so we suppress rather than
    flood the channel with every pre-existing anomaly; this run's state write seeds the set
    and subsequent runs diff correctly. An empty *set* is different: it means the prior run
    is known to have had zero anomalies, so a current anomaly is genuinely new and posts."""
    if prior_anomalous is None:
        return []
    return [r for r in result.get("flagged", [])
            if r.get("anomaly") and r["event_type"] not in prior_anomalous]


_JUDGE_OK = ("ok", "no-candidates")


def gap_has_news(gap: dict | None) -> bool:
    """True iff the Task 4 gap-sweep run-data dict is present and found new gaps."""
    return bool(gap) and gap.get("new_count", 0) > 0


def build_gap_summary_line(gap: dict) -> str:
    """The parent's one-line gaps status, always coherent with the thread below it. Three
    states: N new gaps, no new gaps, or the judge run didn't produce a verdict this run
    (``status`` outside ``_JUDGE_OK``) — surfaced distinctly so silence isn't mistaken for
    a clean sweep."""
    status = gap.get("status", "ok")
    if status not in _JUDGE_OK:
        return (f"🧭 Instrumentation gaps: judgment unavailable this run "
                f"({gap.get('pending_count', 0)} pending)")
    n = gap.get("new_count", 0)
    if n == 0:
        return "🧭 No new instrumentation gaps"
    return f"🧭 {n} new instrumentation gap{'' if n == 1 else 's'}"


def build_gap_thread_blocks(gap: dict) -> list[dict]:
    """Threaded detail for the gap section: the ranked list of new gaps plus a context
    block linking out to the full browse view and the disposition-feedback form. ``[]``
    when there are no new gaps, so the thread doesn't grow an empty section every run."""
    new_gaps = gap.get("new_gaps") or []
    if not new_gaps:
        return []
    rows = "\n".join(
        f"• [{g.get('rank', 5)}] `{g['id']}` ({g['surface_type']}) — {g.get('dashboard_question') or '—'}"
        for g in new_gaps
    )
    body = f"*New instrumentation gaps*\n{rows}"
    # new_gaps is pre-capped at top_n by build_slack_payload, so the thread can't tell
    # overflow occurred from its own length alone — new_count carries the true this-run
    # total (falling back to len(new_gaps) when absent, so older payloads still render).
    new_count = gap.get("new_count", len(new_gaps))
    if new_count > len(new_gaps):
        body += f"\n…and {new_count - len(new_gaps)} more (see the gaps tab)"
    blocks = [_section(body)]
    links = [b for b in (
        f"<{gap['browse_url']}|📄 Browse gaps>" if gap.get("browse_url") else None,
        f"<{gap['feedback_url']}|✍️ Set disposition>" if gap.get("feedback_url") else None,
    ) if b]
    if links:
        blocks.append(_context(" · ".join(links)))
    return blocks


def build_triage_invocation(result: dict, gap: dict | None) -> str | None:
    """Copy-ready `/triage-instrumentation-gaps` line (DATA-2152). The skill reviews two
    queues — new instrumentation gaps AND watchlist proposals — so the entry point renders
    whenever either has work. It used to live inside the gaps thread block, which is
    skipped entirely on a no-new-gaps run, hiding it exactly when the proposal queue is
    the whole backlog (the 2026-08-05 first-run regression). run_date prefers the gap
    payload, falling back to the health result, and is omitted only for older payloads
    that predate both — triage then runs untargeted (defaults to the latest run)."""
    proposals = result.get("proposals") or []
    if not gap_has_news(gap) and not proposals:
        return None
    run_date = (gap or {}).get("run_date") or result.get("run_date")
    return f"🛠 Triage: `/triage-instrumentation-gaps{(' ' + str(run_date)) if run_date else ''}`"


def should_post(
    result: dict,
    changes: dict,
    prior_anomalous: set[str] | None = None,
    gap: dict | None = None,
    red_open: bool = False,
) -> bool:
    """Quiet gate: post only when something changed — or when a red (OKR-anchored) item
    is open. ``red_open`` (DATA-2174) keeps a broken OKR anchor posting every run until
    it resolves; everything else is change-driven and ``still_open`` alone is not news."""
    if red_open:
        return True
    if any(changes.get(k) for k in ("new", "escalated", "resolved")):
        return True
    if _new_anomalies(result, prior_anomalous):
        return True
    return gap_has_news(gap)


def _transition_lines(result: dict, changes: dict, prior_state: dict | None) -> list[str]:
    current = _current_status_map(result)
    lines: list[str] = []
    for e in changes.get("escalated", []):
        prior = (prior_state or {}).get(e, "?")
        lines.append(f"• `{e}`  {prior} → {current.get(e, '?')}")
    for e in changes.get("new", []):
        lines.append(f"• `{e}`  newly flagged ({current.get(e, '?')})")
    for e in changes.get("resolved", []):
        lines.append(f"• `{e}`  resolved")
    return lines


def _pct(current: float, baseline: float) -> str:
    if not baseline:
        return "n/a"
    change = round((current - baseline) / baseline * 100)
    return f"{change:+d}%"


def _pr_number(pr_url: str) -> int:
    number = pr_url.rstrip("/").rsplit("/", 1)[-1]
    return int(number) if number.isdigit() else -1


def _pr_label(pr_url: str) -> str:
    number = pr_url.rstrip("/").rsplit("/", 1)[-1]
    return f"<{pr_url}|PR #{number}>" if number.isdigit() else f"<{pr_url}|PR>"


def _tier_items(triage: dict, tier: str) -> list[dict]:
    return [i for i in (triage.get("items") or []) if i.get("tier") == tier]


def _red_lines(items: list[dict]) -> str:
    lines = []
    for i in items:
        head = f"• `{i['event_type']}`"
        if i.get("okr"):
            head += f" — OKR: {i['okr']}"
        detail = f"  {i.get('headline') or ''}"
        if i.get("action"):
            detail += f" → {i['action']}"
        lines.append(f"{head}\n{detail}")
    return "\n".join(lines)


def _red_section_blocks(items: list[dict]) -> list[dict]:
    """Chunk red items into ``RED_CHUNK_SIZE``-sized section blocks so no single block's
    text can hit Slack's 3000-char cap on a mass-breakage run. The first chunk carries the
    ``*🔴 Needs action (N)*`` heading; the rest are plain continuation sections."""
    blocks = []
    for start in range(0, len(items), RED_CHUNK_SIZE):
        chunk = items[start:start + RED_CHUNK_SIZE]
        body = _red_lines(chunk)
        if start == 0:
            body = f"*🔴 Needs action ({len(items)})*\n{body}"
        blocks.append(_section(body))
    return blocks


def _yellow_section_blocks(items: list[dict]) -> list[dict]:
    """Chunk yellow items into ``YELLOW_CHUNK_SIZE``-sized section blocks — same 3000-char
    guard as ``_red_section_blocks`` (a 200-char judge headline per line adds up). The first
    chunk carries the ``*🟡 Worth watching (N)*`` heading; the item cap's overflow line
    rides the last chunk."""
    shown = items[:YELLOW_CAP]
    lines = [f"• `{i['event_type']}`  {i.get('headline') or ''}" for i in shown]
    if len(items) > YELLOW_CAP:
        lines.append(f"…and {len(items) - YELLOW_CAP} more (see the sheet)")
    blocks = []
    for start in range(0, len(lines), YELLOW_CHUNK_SIZE):
        body = "\n".join(lines[start:start + YELLOW_CHUNK_SIZE])
        if start == 0:
            body = f"*🟡 Worth watching ({len(items)})*\n{body}"
        blocks.append(_section(body))
    return blocks


def _fyi_thread_lines(fyi: list[dict]) -> list[str]:
    """FYI transition detail for the thread. Newly instrumented events group under the
    PR that shipped them (provenance instrumented_pr — DATA-2174); everything else keeps
    the one-line-per-event transition format."""
    new = [i for i in fyi if i.get("change") == "new"]
    rest = [i for i in fyi if i.get("change") != "new"]
    lines: list[str] = []
    by_pr: dict[str, list[dict]] = {}
    for i in new:
        by_pr.setdefault(i.get("instrumented_pr") or "", []).append(i)
    # Numeric PR order (newest first); lexicographic URL order misplaces shorter PR
    # numbers ("pull/99" > "pull/1124"). The no-PR bucket sorts last.
    for pr_url, group in sorted(by_pr.items(), key=lambda kv: _pr_number(kv[0]), reverse=True):
        names = " · ".join(f"`{i['event_type']}`" for i in group)
        if pr_url:
            n = len(group)
            lines.append(f"• {_pr_label(pr_url)} — {n} new event{'' if n == 1 else 's'}: {names}")
        else:
            lines.append(f"• newly flagged: {names}")
    for i in rest:
        if i.get("change") == "resolved":
            lines.append(f"• `{i['event_type']}`  resolved")
        else:
            lines.append(f"• `{i['event_type']}`  {i.get('headline') or ''}")
    # Cap by LINES, not chars — a state-loss run can flag everything, and an uncapped
    # "Informational changes" section can exceed Slack's 3000-char block cap and kill the
    # threaded reply. A PR-grouped line above still counts as just one line here.
    if len(lines) > TRANSITION_CAP:
        overflow = len(lines) - TRANSITION_CAP
        lines = lines[:TRANSITION_CAP]
        lines.append(f"…and {overflow} more (see the sheet)")
    return lines


def build_digest_blocks(
    result: dict,
    changes: dict,
    prior_state: dict | None,
    prior_anomalous: set[str] | None = None,
    gap: dict | None = None,
    triage: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """Return ``(parent_blocks, thread_blocks)`` for a Source B health-digest post.

    Parent = delta-led: status transitions + newly flagged/resolved events, headline
    anomaly/proposal counts, the status breakdown, and the Sheet link. Thread = fuller
    detail: per-event firing anomalies with numbers, watchlist proposals, and the full
    status breakdown. ``prior_state`` (``{event_type: status}`` from the last run) lets
    escalated events render as ``prior → current``; ``None`` (first run) degrades to ``?``.
    ``prior_anomalous`` scopes the headline to *newly* anomalous events (the thread still
    lists all of them). ``gap`` is the Task 4 run-data dict for the instrumentation-gap
    sweep — ``None`` (the digest's only caller today) leaves this byte-identical to the
    health-only digest; when present, its one-line summary is appended to the parent and
    its ranked detail to the thread, so the two sweeps read as one post.
    ``triage`` (DATA-2174) switches the parent to the tiered needs-action / worth-watching
    / FYI layout; ``None`` keeps this byte-identical to the legacy delta-led digest.
    """
    if triage is not None:
        return _build_tiered_blocks(result, changes, prior_anomalous, gap, triage)

    n_changes = sum(len(changes.get(k, [])) for k in ("new", "escalated", "resolved"))
    anomalies = _new_anomalies(result, prior_anomalous)
    proposals = result.get("proposals") or []
    link = sheet_url()

    parent: list[dict] = [
        _header(f"📊 Analytics event health & instrumentation gaps — {result.get('run_date')}")
    ]
    lines = _transition_lines(result, changes, prior_state)
    if lines:
        shown = lines[:TRANSITION_CAP]
        body = f"*{n_changes} change(s) since last run*\n" + "\n".join(shown)
        if len(lines) > TRANSITION_CAP:
            body += f"\n…and {len(lines) - TRANSITION_CAP} more (see the sheet)"
        parent.append(_section(body))
    else:
        parent.append(_section("No status changes since last run."))

    headline_bits = []
    if anomalies:
        headline_bits.append(f"⚠️ {len(anomalies)} new firing anomal{'y' if len(anomalies) == 1 else 'ies'}")
    if proposals:
        headline_bits.append(f"💡 {len(proposals)} watchlist proposal{'' if len(proposals) == 1 else 's'}")
    if headline_bits:
        parent.append(_context(" · ".join(headline_bits)))

    sc = result.get("status_counts") or {}
    breakdown = " · ".join(f"{k} {v}" for k, v in sorted(sc.items(), key=lambda x: -x[1]))
    parent.append(_context(f"Catalog: {breakdown}  ({result.get('total_events', sum(sc.values()))} total)"))

    if link:
        parent.append(_context(f"<{link}|🔗 Full event-state sheet> · 🧵 details in thread"))
    else:
        parent.append(_context("🧵 details in thread"))

    # --- thread ---
    thread: list[dict] = []
    firing = [r for r in result.get("flagged", []) if r.get("anomaly")]
    if firing:
        rows = "\n".join(
            f"• `{r['event_type']}`  {_pct(r['anomaly']['current'], r['anomaly']['baseline'])} WoW "
            f"({r['anomaly']['baseline']:,.0f} → {r['anomaly']['current']:,})"
            for r in firing
        )
        thread.append(_section(f"*Firing anomalies*\n{rows}"))
    if proposals:
        rows = "\n".join(
            f"• `{p['event_type']}`  family: {p.get('family') or '—'}" for p in proposals[:TRANSITION_CAP]
        )
        if len(proposals) > TRANSITION_CAP:
            rows += f"\n…and {len(proposals) - TRANSITION_CAP} more (see the sheet)"
        thread.append(_section(f"*Watchlist proposals*\n{rows}"))
    if sc:
        thread.append(_section(f"*Status breakdown*\n{breakdown}"))
    if not thread:
        thread.append(_section("No additional detail."))

    if gap is not None:
        parent.append(_context(build_gap_summary_line(gap)))
        thread.extend(build_gap_thread_blocks(gap))
    triage_line = build_triage_invocation(result, gap)
    if triage_line:
        thread.append(_context(triage_line))

    return parent, thread


def _build_tiered_blocks(
    result: dict,
    changes: dict,
    prior_anomalous: set[str] | None,
    gap: dict | None,
    triage: dict,
) -> tuple[list[dict], list[dict]]:
    red = _tier_items(triage, "red")
    yellow = _tier_items(triage, "yellow")
    fyi = _tier_items(triage, "fyi")
    proposals = result.get("proposals") or []
    link = sheet_url()

    parent: list[dict] = [_header(f"📊 Analytics event health — {result.get('run_date')}")]
    if red:
        mention = os.environ.get(MENTION_ENV) or "<!here>"
        parent.extend(_red_section_blocks(red))
        parent.append(_context(f"{mention} — key instrumentation needs attention"))
    if yellow:
        parent.extend(_yellow_section_blocks(yellow))
    if not red and not yellow:
        parent.append(_section("Nothing needs action."))

    fyi_bits = []
    if fyi:
        fyi_bits.append(f"{len(fyi)} informational change{'' if len(fyi) == 1 else 's'}")
    if proposals:
        fyi_bits.append(f"{len(proposals)} watchlist proposal{'' if len(proposals) == 1 else 's'}")
    if gap_has_news(gap):
        n = gap.get("new_count", 0)
        fyi_bits.append(f"{n} new gap{'' if n == 1 else 's'}")
    if fyi_bits:
        parent.append(_context(f"ℹ️ {' · '.join(fyi_bits)} — details in 🧵"))
    status = triage.get("status", "ok")
    if status not in ("ok", "no-items"):
        parent.append(_context("⚙️ triage judgment unavailable this run (rules-tier fallback)"))
    if gap is not None and not gap_has_news(gap):
        parent.append(_context(build_gap_summary_line(gap)))
    if link:
        parent.append(_context(f"<{link}|🔗 Full event-state sheet> · 🧵 details in thread"))
    else:
        parent.append(_context("🧵 details in thread"))

    # --- thread: the detail that used to be the parent wall ---
    thread: list[dict] = []
    fyi_lines = _fyi_thread_lines(fyi)
    if fyi_lines:
        thread.append(_section("*Informational changes*\n" + "\n".join(fyi_lines)))
    firing = [r for r in result.get("flagged", []) if r.get("anomaly")]
    if firing:
        rows = "\n".join(
            f"• `{r['event_type']}`  {_pct(r['anomaly']['current'], r['anomaly']['baseline'])} WoW "
            f"({r['anomaly']['baseline']:,.0f} → {r['anomaly']['current']:,})"
            for r in firing
        )
        thread.append(_section(f"*Firing anomalies*\n{rows}"))
    if proposals:
        rows = "\n".join(
            f"• `{p['event_type']}`  family: {p.get('family') or '—'}" for p in proposals[:TRANSITION_CAP]
        )
        if len(proposals) > TRANSITION_CAP:
            rows += f"\n…and {len(proposals) - TRANSITION_CAP} more (see the sheet)"
        thread.append(_section(f"*Watchlist proposals*\n{rows}"))
    sc = result.get("status_counts") or {}
    if sc:
        breakdown = " · ".join(f"{k} {v}" for k, v in sorted(sc.items(), key=lambda x: -x[1]))
        thread.append(_section(
            f"*Status breakdown*\n{breakdown}  ({result.get('total_events', sum(sc.values()))} total)"))
    if not thread:
        thread.append(_section("No additional detail."))
    if gap is not None:
        thread.extend(build_gap_thread_blocks(gap))
    triage_line = build_triage_invocation(result, gap)
    if triage_line:
        thread.append(_context(triage_line))
    return parent, thread


# --- poster (IO; injectable transport) ---------------------------------------


def post_message(
    blocks: list[dict],
    *,
    token: str,
    channel: str,
    text: str = "",
    thread_ts: str | None = None,
    transport: Callable[..., Any] | None = None,
) -> str:
    """POST ``blocks`` to ``chat.postMessage`` and return the message ``ts``.

    ``text`` is the notification/fallback string Slack shows in pushes and screen readers.
    ``thread_ts`` threads this message under a parent. ``transport`` is injected in tests;
    resolved to ``requests.post`` at call time (not a def-time default) so a monkeypatched
    ``requests.post`` is honored. Raises ``RuntimeError`` on a Slack ``ok:false`` response.
    """
    transport = transport or requests.post
    payload: dict[str, Any] = {"channel": channel, "blocks": blocks}
    if text:
        payload["text"] = text
    if thread_ts:
        payload["thread_ts"] = thread_ts
    resp = transport(
        SLACK_POST_URL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("ok"):
        raise RuntimeError(f"Slack chat.postMessage failed: {body.get('error', 'unknown error')}")
    return body["ts"]


def post_digest(
    result: dict,
    changes: dict,
    prior_state: dict | None,
    *,
    token: str,
    channel: str,
    transport: Callable[..., Any] | None = None,
    prior_anomalous: set[str] | None = None,
    gap: dict | None = None,
    triage: dict | None = None,
) -> str | None:
    """Post the health digest: parent message, then the detail as a threaded reply.
    No-op (returns None) when the quiet gate says nothing changed. ``gap`` (Task 4's
    instrumentation-gap run-data dict) threads through to both the quiet gate and the
    block builder, so new gaps alone are enough to post even when the health side is
    quiet. ``triage`` switches to the tiered layout and lets an open red item post even
    on an otherwise quiet run."""
    red_open = bool(triage) and any(
        i.get("tier") == "red" for i in triage.get("items") or [])
    if not should_post(result, changes, prior_anomalous, gap, red_open=red_open):
        return None
    parent, thread = build_digest_blocks(result, changes, prior_state, prior_anomalous,
                                         gap, triage)
    # Fallback text mirrors whichever header the parent actually rendered — the tiered
    # layout dropped "& instrumentation gaps" from its header (Task 5 folded gaps into a
    # context line, not the title), so the legacy string is stale once triage is present.
    fallback_text = (
        f"📊 Analytics event health — {result.get('run_date')}" if triage is not None
        else f"Analytics event health & instrumentation gaps — {result.get('run_date')}"
    )
    ts = post_message(parent, token=token, channel=channel, text=fallback_text,
                      transport=transport)
    # The parent is meaningful on its own and already advertises "details in thread", so a
    # failed reply is a partial success, not a whole-digest failure: log it and still return
    # the parent ts rather than propagating (which the monitor would report as the post failing).
    try:
        post_message(thread, token=token, channel=channel, thread_ts=ts,
                     text="Health digest detail", transport=transport)
    except Exception as exc:  # noqa: BLE001
        print(f"slack: thread reply failed ({exc}); parent message already posted (ts {ts}).",
              file=sys.stderr)
    return ts


def _env_creds() -> tuple[str | None, str | None]:
    return os.environ.get(TOKEN_ENV), os.environ.get(CHANNEL_ENV)


# --- CLI (Source A entry) -----------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Push analytics event-lifecycle updates to Slack.")
    sub = parser.add_subparsers(dest="command", required=True)
    m = sub.add_parser("notify-metadata", help="post a real-time metadata-change update (Source A)")
    m.add_argument("--event", required=True, help="event name (Amplitude display / event_type)")
    m.add_argument("--change", required=True, choices=list(_HEADLINES),
                   help="change type: created | retired | superseded | updated")
    m.add_argument("--status", help="current status line (active/dormant/retired/...)")
    m.add_argument("--product", help="product tag, e.g. product:win")
    m.add_argument("--family", help="event family")
    m.add_argument("--purpose", help="one-line purpose")
    m.add_argument("--source", help="PR # or 'manual (dev feedback)'")
    m.add_argument("--author", help="author handle (no @)")
    m.add_argument("--supersession", help="supersession lineage line")
    m.add_argument("--sheet-url", default=sheet_url(),
                   help="event-state sheet URL (defaults to GP_EVENT_STATE_SHEET_URL, else "
                   "derived from GP_EVENT_STATE_SHEET_ID)")
    m.add_argument("--changed", help="comma-separated changed fields (for --change updated)")
    args = parser.parse_args(argv)

    token, channel = _env_creds()
    # Host gate: skip cleanly on machines without the shared Slack credentials so the
    # event-metadata trigger is a silent no-op, never a prompt or a bottleneck.
    if not token or not channel:
        print(f"Slack event-lifecycle notify not configured on this host "
              f"({TOKEN_ENV}/{CHANNEL_ENV} unset); skipping.", file=sys.stderr)
        return 0

    change = {
        "event": args.event,
        "change_type": args.change,
        "status": args.status,
        "product": args.product,
        "family": args.family,
        "purpose": args.purpose,
        "source": args.source,
        "author": args.author,
        "supersession": args.supersession,
        "sheet_url": args.sheet_url,
        "changed": [c.strip() for c in args.changed.split(",")] if args.changed else None,
    }
    # Non-fatal, like Source B: the Amplitude write (via the event-metadata skill) has
    # already succeeded, and the shell wrapper runs under `set -e`, so a raised RuntimeError
    # (Slack ok:false / rate limit / network) would fail the skill step it must never fail.
    try:
        ts = post_message(build_metadata_blocks(change), token=token, channel=channel,
                          text=f"{args.change}: {args.event}")
        print(f"posted metadata update for {args.event} (ts {ts})")
    except Exception as exc:  # noqa: BLE001
        print(f"slack: metadata notify failed ({exc}); Amplitude write already succeeded.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
