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
TOKEN_ENV = "SLACK_APP_BOT_TOKEN"                       # reuses gp-api's canonical name
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
    event_types that were anomalous on the previous run (``None`` on the first run → every
    anomaly counts as new). This catches both a newly flagged anomalous event and a
    still-flagged event that *develops* an anomaly, while a persistent anomaly (already
    reported on a prior run) stays quiet — so the digest doesn't re-post it every run."""
    prior = prior_anomalous or set()
    return [r for r in result.get("flagged", [])
            if r.get("anomaly") and r["event_type"] not in prior]


def should_post(result: dict, changes: dict, prior_anomalous: set[str] | None = None) -> bool:
    """Quiet gate: post only when something changed. True if any event was newly flagged,
    escalated (status changed), or resolved, or if any flagged event carries an anomaly it
    did not have last run. ``still_open`` alone (same flags, same status, same anomaly
    state as last run) is not news."""
    if any(changes.get(k) for k in ("new", "escalated", "resolved")):
        return True
    return bool(_new_anomalies(result, prior_anomalous))


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


def build_digest_blocks(
    result: dict, changes: dict, prior_state: dict | None, prior_anomalous: set[str] | None = None
) -> tuple[list[dict], list[dict]]:
    """Return ``(parent_blocks, thread_blocks)`` for a Source B health-digest post.

    Parent = delta-led: status transitions + newly flagged/resolved events, headline
    anomaly/proposal counts, the status breakdown, and the Sheet link. Thread = fuller
    detail: per-event firing anomalies with numbers, watchlist proposals, and the full
    status breakdown. ``prior_state`` (``{event_type: status}`` from the last run) lets
    escalated events render as ``prior → current``; ``None`` (first run) degrades to ``?``.
    ``prior_anomalous`` scopes the headline to *newly* anomalous events (the thread still
    lists all of them).
    """
    n_changes = sum(len(changes.get(k, [])) for k in ("new", "escalated", "resolved"))
    anomalies = _new_anomalies(result, prior_anomalous)
    proposals = result.get("proposals") or []
    sheet_url = os.environ.get("GP_EVENT_STATE_SHEET_URL")

    parent: list[dict] = [_header(f"📊 Analytics event health — {result.get('run_date')}")]
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

    if sheet_url:
        parent.append(_context(f"<{sheet_url}|🔗 Full event-state sheet> · 🧵 details in thread"))
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
        thread.append(_section(f"*Watchlist proposals*\n{rows}"))
    if sc:
        thread.append(_section(f"*Status breakdown*\n{breakdown}"))
    if not thread:
        thread.append(_section("No additional detail."))
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
) -> str | None:
    """Post the health digest: parent message, then the detail as a threaded reply.
    No-op (returns None) when the quiet gate says nothing changed."""
    if not should_post(result, changes, prior_anomalous):
        return None
    parent, thread = build_digest_blocks(result, changes, prior_state, prior_anomalous)
    ts = post_message(parent, token=token, channel=channel,
                      text=f"Analytics event health — {result.get('run_date')}", transport=transport)
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
    m.add_argument("--sheet-url", default=os.environ.get("GP_EVENT_STATE_SHEET_URL"),
                   help="event-state sheet URL (or GP_EVENT_STATE_SHEET_URL env)")
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
