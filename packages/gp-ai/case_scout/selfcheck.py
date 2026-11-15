"""The self-check alert (Implementation Notes section 8, "Should never
happen"; S9 ticket): a SECOND, INDEPENDENT check behind the PII gate
(reader/gate.py) — never a replacement for it. Scans what already reached
GitHub (open case-scout-labeled PR bodies) and what a run is about to
publish (its bundle.json) for a conversation-id-shaped string or an email
address, alerting through alerts.post_alert on any hit.

Deliberately redefines its own patterns rather than importing gate.py's: the
whole point of a second check is structural independence, so a bug in one
check's regex can't blind the other.

Top-level (not under reader/) so it's importable from the Publisher's Lambda
action (publisher.py, which calls this at the end of run_publish) without
reaching into the Reader's package — this check only ever needs the
Publisher's own GitHub client and the bucket, never a transcript.
"""

import json
import re
from typing import Any, Protocol

from case_scout import alerts
from case_scout.bucket import CaseScoutBucket

_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
# Conversation ids in this codebase are opaque strings (messages.py's
# Message.conversation_id / sessions.py's Session.conversation_id) with no
# fixed format documented here, so this errs toward a generic UUID pattern
# rather than a narrow one that would miss whatever format production
# actually uses — paired below with a literal-match check against this run's
# OWN known-real conversation ids, which catches a leak regardless of shape.
_UUID_PATTERN = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")


class PrListingClient(Protocol):
    def list_open_labeled_prs(self, label: str) -> list[dict[str, Any]]: ...
    def get_pr_body(self, number: int) -> str: ...


def _redact(hit: str) -> str:
    """The whole point of this check is keeping PII out of GitHub and Slack
    — alerting on a hit by repeating the matched email/uuid/conversation id
    back into the Slack message this posts (via alerts.post_alert -> the
    failures SNS topic -> the shared Slack notifier) would defeat that for
    the alert channel itself. Keeps everything else in the hit string (which
    pattern matched, the PR number or run id, the caseId a conversation id
    leaked into) since that's exactly what a responder needs to go find and
    fix the real location — only the matched value itself is replaced."""
    redacted = _EMAIL_PATTERN.sub("<redacted-email>", hit)
    redacted = _UUID_PATTERN.sub("<redacted-uuid>", redacted)
    # _scan_bundle's own hit shape ("conversationId:<id> leaked into bundle
    # for caseId=...") carries a real id that's neither pattern above (test
    # fixtures use plain strings like "conv-abc123", not a UUID).
    redacted = re.sub(r"(?<=conversationId:)\S+", "<redacted-id>", redacted)
    return redacted


def find_pii_hits(text: str) -> list[str]:
    """Every distinct pattern match in `text`, tagged by which pattern hit —
    empty if clean."""
    hits = [f"email:{m.group(0)}" for m in _EMAIL_PATTERN.finditer(text)]
    hits.extend(f"uuid:{m.group(0)}" for m in _UUID_PATTERN.finditer(text))
    return hits


def _scan_bundle(bundle: dict[str, Any], sources: dict[str, Any]) -> list[str]:
    bundle_text = json.dumps(bundle)
    hits = find_pii_hits(bundle_text)
    for case_id, source in sources.items():
        conversation_id = source.get("conversationId")
        if conversation_id and conversation_id in bundle_text:
            hits.append(f"conversationId:{conversation_id} leaked into bundle for caseId={case_id}")
    return hits


def run_self_check(
    bucket: CaseScoutBucket,
    github: PrListingClient,
    environment: str,
    recent_run_ids: list[str],
    label: str = "case-scout",
) -> list[str]:
    """Scans open `label`-tagged PR bodies and each of `recent_run_ids`'
    bundle.json for a conversation-id-shaped string or an email address.
    Returns every hit found (empty = clean); posts one alert with the full
    list if there's anything to report. Never raises — a self-check that
    crashes the Publisher would be worse than one that silently finds
    nothing this run."""
    hits: list[str] = []

    try:
        open_prs = github.list_open_labeled_prs(label)
    except Exception as e:
        print(f"ERROR: case_scout self-check: failed to list open {label} PRs: {type(e).__name__}: {e}")
        open_prs = []

    for pr in open_prs:
        try:
            body = github.get_pr_body(pr["number"])
        except Exception as e:
            print(f"ERROR: case_scout self-check: failed to read PR #{pr['number']}'s body: {type(e).__name__}: {e}")
            continue
        hits.extend(f"PR #{pr['number']}: {hit}" for hit in find_pii_hits(body))

    for run_id in recent_run_ids:
        try:
            bundle = bucket.read_run_bundle(run_id)
        except Exception as e:
            print(f"ERROR: case_scout self-check: failed to read bundle for runId={run_id}: {type(e).__name__}: {e}")
            continue
        if bundle is None:
            continue
        sources = bucket.read_run_sources(run_id) or {}
        hits.extend(f"run {run_id}: {hit}" for hit in _scan_bundle(bundle, sources))

    if hits:
        alerts.post_alert(
            environment,
            subject="case scout self-check found possible PII",
            message="; ".join(_redact(h) for h in hits[:20]),
        )
    return hits
