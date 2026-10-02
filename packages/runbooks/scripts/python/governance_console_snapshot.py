"""Build the governance console's data file: everything the page renders, in one JSON.

Joins, all in one pass:
  - the health report (gitignored, present in the workspace during the cron run):
    status counts, the flagged set, watchlist proposals, alignment findings
  - instrumentation_gaps.json (committed): the gap queue and its dispositions
  - the explorer snapshot (committed): the area rollup, so the two pages cannot disagree

Runs in the analytics-governance workflow after the health step, which is what lets it
read a report that is never committed, and by hand:

  uv run governance_console_snapshot.py \
    -o ../../surfaces/governance-console/data/governance-console.json

The report is gitignored and lives 30 days as a CI artifact, so a local rebuild needs
`gh run download <run> --name analytics-event-health-report --dir instrumentation_data`
first, or the builder joins today's gap state onto a stale report and refuses.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, timezone
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import analytics_event_health as aeh  # noqa: E402
import digest_triage as dt  # noqa: E402

GAPS = PY / "instrumentation_data" / "instrumentation_gaps.json"
REPORT = PY / "instrumentation_data" / "analytics_event_health_report.json"
CODE_CSV = PY / "instrumentation_data" / "amplitude_event_provenance.csv"
EXPLORER = (
    PY.parent.parent.parent
    / "prototypes/app/p/analytics-event-explorer/data/event-explorer.json"
)

# A gap the sweep is still waiting on a ruling for. Everything else has been judged and
# belongs in `settled`, visible but out of the queue.
UNTRIAGED_GAPS = frozenset({"new", "open"})

# Ranks for the queues the health monitor does not rank. They sort below every flag,
# because a flag is a thing that broke and these are things that could be better.
PROPOSAL_RANK = 50
ALIGNMENT_RANK = 40

# Each queue's verbs, in its own vocabulary, as {value: label}. These are the reviewer's
# words, not the storage format, and Queue A is where that distinction bites:
# `apply_seed_dispositions` validates against {new, open, accepted, dismissed} and
# SKIPS anything else with only a stderr warning. So `accept` -> `accepted`,
# `dismiss` -> `dismissed`, `defer` -> `open` has to happen on the way back in, and a
# handoff applied without it loses every Queue A ruling quietly. The mapping lives in
# the triage skill's Queue A table, which is the one place that writes this file.
FLAG_VERBS = {
    "govern": "Fix in Govern",
    "dismiss": "Dismiss cause",
    "ticket": "Ticket it",
    "investigate": "Look into it",
}

GAP_VERBS = {"accept": "Accept", "dismiss": "Dismiss", "defer": "Defer"}

PROPOSAL_VERBS = {
    "accept": "Add to watchlist",
    "dismiss": "Dismiss",
    "defer": "Defer",
}

ALIGNMENT_VERBS = {
    "fix_omni": "Fix in omni",
    "draft_upstream": "Draft upstream",
    "dismiss": "Dismiss",
    "defer": "Defer",
}

# What each verb actually DOES, in plain words, for the review panel and the button
# tooltips. The labels above name the button you press; these name the consequence.
#
# The distinction is the whole point. "Fix in Govern" tells you which control you
# touched; "Write the retirement to Amplitude, and every consumer will read these as
# dead" tells you what you are about to do to other people. A page that only ever shows
# the first is one where the person who built the system cannot read back his own
# decisions -- which is exactly what happened on the first run.
#
# One sentence, active voice, no internal names. Anything permanent says so, because
# permanence is the property that decides how carefully a row is worth reading.
VERB_EFFECTS = {
    "flags": {
        "govern": (
            "Write this to Amplitude Govern. A retirement here tells every consumer "
            "the events are dead."
        ),
        # Not a verb. The same verb when the operator has declared in the proof box
        # that the write is not a retirement (`no removal:`). The page swaps the
        # sentence, so a correction is never described back to its author as a
        # retirement -- which is the one thing they just said it was not.
        "govern:correction": (
            "Correct this event's declaration in Amplitude Govern. Nothing is retired."
        ),
        "dismiss": (
            "Stop the digest ever raising this cause again. There is no expiry and "
            "nothing revisits it."
        ),
        "ticket": (
            "File it in the Data backlog. The digest keeps raising it until the cause "
            "clears or is dismissed."
        ),
        "investigate": "Leave it open, on the record that you are looking into it.",
        # Variants for a ruling on events picked out of a cause. Silencing works per
        # cause only: there is no per-event record yet, so a subset cannot be quieted
        # without quieting the whole cause, and these sentences must not promise it.
        "dismiss:event": (
            "Note these as fine for this review only. Nothing is silenced: they are "
            "raised again next run, and leave this cause on their own once it stops "
            "applying to them."
        ),
        "ticket:event": (
            "File these in the Data backlog. They are raised again next run."
        ),
    },
    "gaps": {
        "accept": (
            "Agree the surface is missing an event. It becomes a ticket, or gets "
            "instrumented directly."
        ),
        "dismiss": (
            "Record that this surface does not need an event. Permanent: the sweep "
            "stops offering it."
        ),
        "defer": "Leave it for a later run. It comes back next time.",
    },
    "proposals": {
        "accept": "Add the event to the watchlist, so the monitor tracks it from now on.",
        "dismiss": (
            "Record that this event should not be watched. Permanent: it stops being "
            "proposed."
        ),
        "defer": "Leave it for a later run. It comes back next time.",
    },
    "alignment": {
        "fix_omni": (
            "Change omni's behavior registry to match what the semantic layer declares."
        ),
        "draft_upstream": (
            "Draft an anchored_on change for gp-data-platform. Nothing in omni changes."
        ),
        "dismiss": (
            "Record that this mismatch is fine. Permanent: it stops being raised."
        ),
        "defer": "Leave it for a later run. It comes back next time.",
    },
}

EVIDENCE_COLS = (
    "event_type", "status", "event_count_30d", "last_seen_date",
    "divergence", "instrumented_pr", "okr", "elevated",
)


class StaleReport(Exception):
    """The health report predates the committed state it would be joined with."""


# --- recommendations ----------------------------------------------------------
#
# Every row arrives with a suggested verb and the reason for it, the way
# /triage-instrumentation-gaps shows the judge's verdict before asking for one. The
# operator approves or overrides; nothing here decides anything on its own.
#
# The verbs are each queue's own vocabulary, not a shared one. Queue A's are the
# literals instrumentation_gaps.apply_seed_dispositions validates against, so a handoff
# needs no translation on the way back in.

# Most flagged causes resolve to a metadata write rather than an investigation: the code
# is gone and Govern still says in use. Where a cause can point either way, the
# recommendation is to look, not to write.
FLAG_RECOMMENDATIONS = {
    "call_site_removed": (
        "govern",
        "Nothing in the code sends these any more, and Amplitude still says they are "
        "in use. Retiring them is the fix.",
    ),
    "intent_divergence": (
        "govern",
        "What Amplitude says about these and what they actually do disagree. Amplitude "
        "is where you correct it.",
    ),
    "orphaned_firing": (
        "investigate",
        "Two different problems look identical here: old app versions still sending a "
        "genuinely retired event, and a declaration that is simply wrong. Check when "
        "each one last fired before writing anything.",
    ),
    "counter_blind_spot": (
        "ticket",
        "This is our own search failing to find code that is there, not a problem with "
        "the product. It is fixed in our tooling, and it cannot be dismissed.",
    ),
    "okr_anchor_dormant": (
        "investigate",
        "A number the company steers by is wrong right now. It clears when the event "
        "recovers, or when someone changes the metric's definition, and it cannot be "
        "dismissed.",
    ),
    "anomaly_drop": (
        "investigate",
        "A live event dropped without an obvious cause. Nothing to write until the "
        "cause is known.",
    ),
}


def recommend_flag(cause: str) -> tuple[str, str]:
    """Suggested verb for a flagged cause, plus why. Unknown causes get no suggestion.

    The three judgment causes (never_observed, dormant, dormant_elevated) deliberately
    have no recommendation: they are 112 of today's 174 flags and every one of them
    turns on product knowledge the monitor does not have.
    """
    base = cause.partition("@")[0]
    return FLAG_RECOMMENDATIONS.get(base, ("", ""))


def recommend_gap(gap: Mapping) -> tuple[str, str]:
    """Suggested verb for an instrumentation gap.

    A gap in the file has already passed the judge (only ``is_gap: true`` verdicts are
    folded into state), so the standing suggestion is accept. A prior ruling on a
    resplit predecessor overrides it, because that is a decision already made.
    """
    prior = gap.get("prior_ruling") or {}
    if prior.get("disposition") in ("accepted", "dismissed"):
        return (
            "accept" if prior["disposition"] == "accepted" else "dismiss",
            f"Ruled {prior['disposition']} at this location on "
            f"{prior.get('ruled_on') or 'an earlier run'}"
            + (f": {prior['reason']}" if prior.get("reason") else "")
            + ". Usually the same call.",
        )
    return ("accept", gap.get("judge_reason") or "The judge called this a real gap.")


ALIGNMENT_RECOMMENDATIONS = {
    1: ("fix_omni",
        "omni is behind what the semantic layer declares, so omni is what changes."),
    2: (
        "draft_upstream",
        "The declaration is behind the product. The output is a proposed change for "
        "gp-data-platform, never an edit here.",
    ),
    3: (
        "investigate",
        "The two disagree on scope. A human settles it before it becomes a case 1 or a "
        "case 2.",
    ),
}


# --- signal caveats -----------------------------------------------------------
#
# What a finding is actually based on, and the known ways that evidence misleads.
#
# Written for someone who has never worked on the governance pipeline. The first run of
# this console cleared three decisions out of twenty-six, and one of the three took
# forty minutes, because verifying it meant re-deriving a blind spot that was already
# written down -- in our own vocabulary, in a doc whose section heading nobody would
# search for. A caveat that only its author can read has not been written down.
#
# So: plain words in the four prose fields, and every internal name -- column, function,
# ticket -- confined to `names`, which the page renders as a separate line for whoever
# is going to go and debug it. If a sentence cannot be read by someone who has never
# seen the pipeline, it belongs in `names` or in the book, not here.
#
# `wrong: None` is the load-bearing case. "Nothing known distorts this" is what tells
# someone to stop looking, and the looking is what costs the forty minutes.
#
# These restate no facts of their own. Every entry here is a row in
# `books/analytics-governance-gotchas.md`, which is where one gets added when it is
# found and deleted when it is fixed; this map is how a row reaches the one person who
# has to rule on it.

GOTCHAS = "books/analytics-governance-gotchas.md"
HEALTH_BOOK = "books/monitor-analytics-event-health.md"


def _caveat(measured, means, wrong=None, check=None, names="", reference=GOTCHAS) -> dict:
    return {
        "measured": measured,
        "means": means,
        "wrong": wrong,
        "check": check,
        "names": names,
        "reference": reference,
    }


CAUSE_CAVEATS = {
    "call_site_removed": _caveat(
        "We search the code for every place that sends each event, and record when one "
        "was deleted. Nothing in the code sends these any more, and they have stopped "
        "appearing in Amplitude.",
        "The event's name is still declared, but the code that sent it is gone. These "
        "are candidates to retire.",
        "Both of the ways this used to mislead are now fixed. A 30-day window that "
        "straddles the deletion date no longer reads as traffic after it, and an event "
        "whose location in the code we cannot work out is recorded as unknown rather "
        "than as zero. What is left is that this group can be too small: an event we "
        "cannot find in the code never reaches it at all.",
        "Trust the events listed here. Do not read an event's absence from this group "
        "as evidence that its code survives.",
        "call_site_count, call_site_retired_date, "
        "call_site_removal_straddles_window (DATA-2427)",
    ),
    "counter_blind_spot": _caveat(
        "We search the code for every place that sends each event. We found none for "
        "these, and yet Amplitude shows them firing normally, some of them thousands "
        "of times a month.",
        "An event cannot fire if nothing in the code sends it. So our search is wrong, "
        "not the event. These events are alive, and this is a fault in our tooling "
        "rather than a problem with the product.",
        "A second, quite different situation lands here looking identical: an event "
        "whose code really was deleted, but where we could not work out when. The "
        "common case of that was fixed on 2026-09-29, but the fix only reaches an "
        "event at the next weekly history walk, so one deleted shortly before then "
        "can still sit here until it runs.",
        "Look at the other events grouped with this one. If they were deleted in the "
        "same change and carry a removal date while this one does not, its code was "
        "probably deleted too and the date is still to come.",
        f"call_site_count, count_call_sites, call_site_retired_date (DATA-2577). "
        f"Full triage in {HEALTH_BOOK} section 'Rank 0'",
    ),
    "orphaned_firing": _caveat(
        "Someone marked these events 'not in use' in Amplitude Govern, and Amplitude "
        "shows them still firing after that date.",
        "The declaration and reality disagree. Either the event was retired and "
        "something is still sending it, or the declaration is simply wrong.",
        "A freshly retired event no longer lands here; there is a grace period for "
        "that. What does land here is a rename that was declared but never built. "
        "Someone marked the old event dead and named a replacement, the replacement "
        "was never written, and the old event keeps firing because it is still the "
        "only one there is.",
        "Find the replacement event named in the declaration. If nothing in the code "
        "sends it and it has never fired, the rename never happened, and it is the "
        "declaration that needs fixing rather than the event.",
        "event_count_30d, retired_date, ORPHAN_GRACE_DAYS (DATA-2140), DATA-2573",
    ),
    "intent_divergence": _caveat(
        "We compare what Amplitude Govern says about an event with what the data shows "
        "it doing.",
        "The two disagree. Either Govern says the event is in use and its code is "
        "gone, or Govern says it is dead and it is still firing. One of the two is "
        "wrong, and which one decides what you do about it.",
        "The same unbuilt-rename trap as the group above. A 'not in use' declaration "
        "naming a replacement that was never written reads here as a problem with the "
        "event, when the problem is the declaration.",
        "If a replacement event is named, confirm that something in the code sends it "
        "and that it has actually fired, before changing anything about this event.",
        "the divergence column, DATA-2573",
    ),
    "never_observed": _caveat(
        "Amplitude holds a definition for each of these events and no data behind it. "
        "Not one of them has ever fired.",
        "Every event here was found in the code and either shipped more than 30 days "
        "ago or is one we watch closely, so the silence means something. Other events "
        "that shipped more recently and have not fired yet are left out of this group, "
        "and the digest counts them as too new to judge.",
        "Ruling on some events here does not stop them coming back next run; an event "
        "leaves on its own the first time it fires.",
        "Before calling one broken, check that the code that sends it can still run and "
        "that the action behind it is one people actually take.",
        "instrumented_never_observed, DATA-2588",
    ),
    "dormant": _caveat(
        "Nothing fired in the last 30 days.",
        "The event has gone quiet. It may be broken, or it may simply be rare.",
        "Thirty days is not a season. We hold no expectation of how often any "
        "individual event should fire, so a genuinely infrequent one looks exactly "
        "like a broken one.",
        "Look at when it last fired and ask whether that gap is unusual for this "
        "particular event. Something quarterly going quiet for a month means nothing.",
        "event_count_30d",
    ),
    "dormant_elevated": _caveat(
        "Nothing fired in the last 30 days, on events we watch more closely, because "
        "they are on the curated watchlist or belong to onboarding, activation or "
        "compliance.",
        "The event has gone quiet, and it is one we care about more than most. It may "
        "be broken, or it may simply be rare.",
        "The same 30-day blindness as the ordinary dormant group. Watching an event "
        "more closely raises how loudly this gets reported; it does not give us any "
        "better idea of how often the event ought to fire.",
        "Check another event on the same page. If that one still fires, the page "
        "works and this action is simply rare. If nothing on the page fires, check "
        "the page is still reachable: code can survive inside a screen nobody can "
        "open any more.",
        "event_count_30d, is_elevated",
    ),
    "okr_anchor_dormant": _caveat(
        "A metric the company steers by is built on this event, and the event has "
        "broken. We hold the finding open by comparing against how it looked before "
        "the break, rather than against a recent average.",
        "A number the leadership reads is wrong right now. It stays flagged until the "
        "event recovers, or until someone changes the metric's definition upstream.",
        "This finding itself is sound. What it does not cover is everything else: only "
        "metrics declared in the semantic layer get this treatment. Every other event "
        "is judged against a rolling four-week average, which quietly absorbs a "
        "break. After about a month of being broken, the broken level becomes the "
        "normal one and the alarm switches itself off. That is how a wrong OKR ran "
        "unnoticed for a month.",
        "Do not read the absence of this warning as health, inside the semantic layer "
        "or out. It only catches a break that starts while it is watching: one older "
        "than about nine weeks never raises it. Compare the weekly numbers against a "
        "level from before any suspected break, never against the recent average.",
        "okr_latch.py, anchored_on (DATA-2421)",
    ),
    "anomaly_drop": _caveat(
        "Volume fell sharply compared with the previous four weeks.",
        "Something changed, suddenly. This is a good detector of a cliff.",
        "It is a poor detector of a long-running break. After about four weeks the "
        "broken level becomes the very average it compares against, so the alarm "
        "stops. A break that has been running a while will not appear here at all.",
        "Look at when the drop started. If this is surfacing now but the drop began "
        "months ago, the comparison has already moved underneath it.",
        "detect_anomaly",
    ),
}


QUEUE_CAVEATS = {
    "gaps": _caveat(
        "We scan product screens for places an event ought to fire, such as a form "
        "being submitted or a step being completed, and check whether any tracking "
        "call sits nearby. An LLM then judges what the scan found.",
        "This screen looks like it should send an event, and we found no tracking call "
        "on it.",
        "Two ways. The scan recognises only three ways of sending an event, so a "
        "screen that sends one through a private helper, or by handing the event name "
        "to a local function, reads as untracked when it is not. Separately, three of "
        "the five patterns we use to scan backend code match nothing in gp-api at all, "
        "so an empty backend queue means we are not looking rather than that there is "
        "nothing to find.",
        "Treat a missing tracking call as weak evidence, not proof. If the snippet "
        "shows a helper-shaped call (tryX, emit, log) or a bare event name in quotes, "
        "it is probably tracked already. And never read an empty backend queue as "
        "coverage.",
        "has_tracking_call, tracked_in_hook (DATA-2560)",
    ),
    "proposals": _caveat(
        "We compare every event in the catalog against the watchlist, and list "
        "anything belonging to a family we already watch that is not itself watched.",
        "We watch this family of events, and this one is not being watched.",
        None,
        None,
        "monitored_events.yaml",
    ),
    "alignment": _caveat(
        "We compare the events omni associates with each governed metric against the "
        "events gp-data-platform's semantic layer declares for that same metric.",
        "The two repositories disagree about which events a metric is made of.",
        "How we judge whether a metric's input is alive depends on how precisely the "
        "metric was declared. If the declaration narrows the event, to one page or by "
        "excluding certain values, we check that narrower slice's own numbers. If "
        "it just names the event, we read the whole event's status. So a metric that "
        "really counts one slice of a busy event can look perfectly healthy while its "
        "slice is dead. That is how the outreach terminal stayed green for weeks after "
        "the in-product send stopped working.",
        "If the metric counts less than the whole event, check whether the declaration "
        "actually says so. A narrowing nobody wrote down is invisible to this check.",
        "anchored_on, sem_*.yml, sem_anchors.Leg",
    ),
}


def caveat_for_cause(cause: str) -> dict | None:
    """What a flagged cause is based on, and how that evidence is known to mislead.

    Keyed on the cause base, so `call_site_removed@2026-09-01` and
    `call_site_removed@2026-07-14` carry the same caveat: the qualifier separates two
    decisions, not two kinds of evidence.
    """
    return CAUSE_CAVEATS.get(cause.partition("@")[0])


# --- overview -----------------------------------------------------------------


def build_overview(report: Mapping, explorer: Mapping) -> dict:
    """Catalog rollup: totals, counts by status, counts by area, metadata coverage.

    The area rollup is lifted from the explorer snapshot rather than recomputed, so the
    two pages cannot disagree about which area an event belongs to. That filing rule has
    moved once already (DATA-2532) and having one producer is what stops it drifting.
    """
    coverage = dict(report.get("metadata_coverage") or {})
    scored = coverage.get("scored") or 0
    described = coverage.get("with_description") or 0
    coverage["described_pct"] = round(100 * described / scored) if scored else 0
    return {
        "totals": {
            "events": report.get("total_events") or 0,
            "flagged": len(report.get("flagged") or []),
        },
        "by_status": dict(report.get("status_counts") or {}),
        "by_area": list(explorer.get("areas") or []),
        "metadata_coverage": coverage,
    }


# --- event cards --------------------------------------------------------------
#
# The explorer's per-event card, carried for exactly the events this run's queues
# mention, so clicking a name in an evidence table opens the same card people already
# know from the explorer instead of sending them to another tab.
#
# It is lifted from the explorer snapshot rather than rebuilt, for the same reason the
# area rollup is: one producer, so the two pages cannot describe the same event
# differently. Only the events under an open decision are carried; the whole catalog
# would be most of a megabyte of page nobody opens.
#
# The card is what makes several of the caveats actionable. "Find the replacement event
# named in the declaration" needs the supersession note; "ask whether that gap is
# unusual for this event" needs the weekly series. Both were a tab away.
CARD_FIELDS = (
    "display_name", "area", "description", "status", "fires_on", "url",
    "fires_on_source", "anchor_confidence", "anchor_flag_reason",
    "count_30d", "count_total", "last_seen", "first_seen", "series",
    "tags", "okr", "okr_metrics", "supersession", "declared_intent", "watchlist_status",
    "questions", "used_by", "provenance",
)


def queue_event_types(queues: Sequence[Mapping]) -> set[str]:
    """Every event named anywhere in this run's queues.

    Flags carry their members in ``events``; a proposal is itself an event; a gap is
    about a surface and names none.
    """
    names: set[str] = set()
    for queue in queues:
        for item in queue["items"]:
            names.update(item.get("events") or [])
            if queue["queue"] == "proposals":
                names.add(item["id"])
    return names


def _call_site_count(raw) -> int | None:
    """The CSV hands back strings, and this is the one column where that is dangerous.

    Blank means the walk resolved no key path; "0" means it resolved one and found no
    callers. They are different findings, so blank becomes None and never 0. Left as a
    string, the page compared `"0" === 0` (false) and `"1" > 0` (true by coercion), so
    the distinction worked by luck in one direction and failed silently in the other.
    """
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def build_event_cards(
    explorer: Mapping, wanted: Iterable[str], code: Mapping | None = None
) -> dict:
    """``{event_type: card}`` for the wanted events the explorer snapshot knows about.

    An event with no explorer row simply has no card, and the page falls back to the
    evidence row it already shows. That is the normal state for anything declared in
    Govern and never observed, which is a third of the flagged set.

    The call-site pair is joined on from the provenance CSV, because without it the card
    appears to contradict the row it was opened from. `retired_date` is set only when the
    event's NAME has gone from the tree; `call_site_count` counts what still CALLS that
    name. An event can sit under "call sites removed" while its card says "still in the
    code", and both are true: the constant survives, nothing calls it. That is the whole
    finding rank 2 exists to catch, and a card that shows one half of it is a card that
    argues with its own queue.
    """
    wanted = set(wanted)
    code = code or {}
    cards = {}
    for event in explorer.get("events") or []:
        name = event.get("event_type")
        if name not in wanted:
            continue
        card = {k: event[k] for k in CARD_FIELDS if k in event}
        row = code.get(name) or {}
        card["call_site_count"] = _call_site_count(row.get("call_site_count"))
        card["call_site_retired_date"] = row.get("call_site_retired_date") or None
        cards[name] = card
    return cards


# --- code provenance ----------------------------------------------------------
#
# A blank PR link currently means three unrelated things, so the page names the state
# instead of showing an empty cell. The walk produces four outcomes and they carry
# different rulings: "instrumented last Thursday and quiet" is timing, "never found in
# code at all" is usually a runtime-built name or a backend event the walk does not
# cover, and those are not the same finding.
def provenance_state(row: Mapping | None) -> str:
    """How much the provenance walk knows about where this event was instrumented."""
    row = row or {}
    commit = bool(row.get("instrumented_commit"))
    pr = bool(row.get("instrumented_pr"))
    if commit and pr:
        return "full"
    if commit:
        # Mostly pre-monorepo: the (#123) in the subject does not resolve to an omni PR.
        return "commit only"
    if pr:
        # A hint written per-PR by instrument-analytics-event; the walk overwrites it.
        return "provisional"
    return "not found in code"


def _days_between(earlier: str | None, later: str | None) -> int | None:
    if not earlier or not later:
        return None
    try:
        return (date.fromisoformat(later) - date.fromisoformat(earlier)).days
    except ValueError:
        return None


def _elevated_note(members: Sequence[Mapping], elevated: Sequence[str]) -> str:
    """Why this cause has the elevation it has, so a column of blanks reads as a fact.

    ``is_elevated`` keys off curated-watchlist membership, the win_onboarding family,
    win_compliance_or* prefixes, or an onboarding / activation / compliance name.
    """
    total = len(members)
    if elevated:
        return (
            f"{len(elevated)} of {total} elevated: on the curated watchlist, or in an "
            "onboarding, activation or compliance family."
        )
    if all(not m.get("family") for m in members):
        return (
            "None elevated, and none can be: these have never fired, so they have no "
            "catalog row and no family for the elevation rules to read."
        )
    return (
        f"None of {total} elevated: not on the curated watchlist, and neither the "
        "family nor the name matches an onboarding, activation or compliance rule."
    )


# --- the flags queue ----------------------------------------------------------


def _verbs(verbs: Mapping[str, str], dismissable: bool) -> dict:
    """A row's verbs, minus dismiss where the loader would refuse it.

    Dropped rather than disabled: a button that cannot work is a promise the page
    cannot keep, and a dismissal written anyway does nothing except report itself in
    the next digest.
    """
    return {k: v for k, v in verbs.items() if dismissable or k != "dismiss"}


def _flag_evidence(record: Mapping, code: Mapping, run_date: str | None) -> dict:
    row = {col: record.get(col) for col in EVIDENCE_COLS}
    provenance = code.get(record["event_type"])
    instrumented = (provenance or {}).get("instrumented_date") or None
    row["instrumented_date"] = instrumented
    row["days_since_instrumented"] = _days_between(instrumented, run_date)
    row["provenance"] = provenance_state(provenance)
    row["removed_by_pr"] = (provenance or {}).get("call_site_retired_pr") or None
    return row


_OMNI_PR = re.compile(r"github\.com/thegoodparty/omni/pull/(\d+)")


def removal_proof(evidence: list[dict]) -> str:
    """The PRs that deleted a cause's call sites, as the console's proof box accepts them.

    Only ever a suggestion the reviewer sees and can edit: a Govern write still carries
    whatever they leave in the box. Empty when no event names its removing commit, so an
    unattributed removal is never dressed up as an evidenced one.
    """
    refs: list[str] = []
    for row in evidence:
        url = row.get("removed_by_pr")
        if not url:
            continue
        m = _OMNI_PR.search(url)
        ref = f"#{m.group(1)}" if m else url
        if ref not in refs:
            refs.append(ref)
    return ", ".join(refs)


def _sorted_evidence(rows: list[dict]) -> list[dict]:
    """Oldest first, undated last, alphabetical within a tie.

    Age is the axis that splits a cause: on never-observed, two events silent since June
    sat sixty alphabetical rows below events instrumented last Thursday. Undated rows go
    last as their own block rather than being treated as infinitely old, because "never
    found in code" is a different finding from "old", and they read better together.
    """
    return sorted(
        rows,
        key=lambda r: (
            r["days_since_instrumented"] is None,
            -(r["days_since_instrumented"] or 0),
            r["event_type"],
        ),
    )


def build_flag_queue(report: Mapping, code: Mapping | None = None) -> list[dict]:
    """The flagged set as one row per cause, in the digest's own grouping and order, with
    any cause holding an OKR break moved to the top.

    A cause, not an event, is the unit: one deploy that stranded twenty-two name
    constants is one ruling, not twenty-two. ``aeh.cluster_flagged`` already does the
    grouping the digest prints, so the page and the digest cannot disagree about what a
    cause contains or what it is called.

    Unlike the digest this keeps the counter-blind-spot rows and the dormant tail in the
    same list. The digest splits them out because it is a push stream with a headline
    number to protect; the console is a pull surface where the whole state is the point.
    """
    code = code or {}
    run_date = report.get("run_date")
    records = list(report.get("flagged") or [])
    by_cause: dict[str, list[Mapping]] = {}
    for record in records:
        by_cause.setdefault(aeh.cause_key(record), []).append(record)

    dismissed = report.get("dismissed_causes") or {}
    items = []
    for group in aeh.cluster_flagged(records):
        cause = group["cause"]
        reason = dismissed.get(cause)
        verdict, why = recommend_flag(cause)
        dismissable = cause.partition("@")[0] not in aeh.UNDISMISSABLE_CAUSES
        evidence = _sorted_evidence(
            [_flag_evidence(record, code, run_date) for record in by_cause.get(cause, [])]
        )
        items.append({
            "id": cause,
            "queue": "flags",
            "verbs": _verbs(FLAG_VERBS, dismissable),
            "caveat": caveat_for_cause(cause),
            "recommended": verdict,
            "recommendation_reason": why,
            "label": group["label"],
            "rank": group["rank"],
            "count": group["count"],
            "events": group["events"],
            "elevated": group["elevated"],
            "okr_break": sorted(
                r["event_type"] for r in by_cause.get(cause, []) if dt.is_okr_break(r)
            ),
            "dismissable": dismissable,
            "dismissed": {"reason": reason} if reason is not None else None,
            "elevated_note": _elevated_note(
                by_cause.get(cause, []), group["elevated"]
            ),
            "evidence": evidence,
            "proof_hint": removal_proof(evidence),
        })
    # The digest raises an OKR break every run, whatever its rank, so the console has to
    # lead with it too, or the one item Slack calls urgent sits tenth on this page.
    items.sort(key=lambda item: not item["okr_break"])
    return items


# --- what changed -------------------------------------------------------------


def current_flagged_map(report: Mapping) -> dict[str, str]:
    """``{event_type: status}`` for this run's flagged set, the shape the diff compares."""
    return {r["event_type"]: r["status"] for r in (report.get("flagged") or [])}


def prior_flagged(previous: Mapping | None) -> dict[str, str] | None:
    """The previous snapshot's flagged map, or None when there is no previous snapshot.

    None and {} mean different things. None is a first run, where everything is new
    because nothing was ever seen. {} is a run where nothing was flagged, where
    everything is new because the catalog really was clean.
    """
    if previous is None:
        return None
    prior = previous.get("prior_flagged")
    return dict(prior) if isinstance(prior, dict) else None


def build_changes(report: Mapping, previous: Mapping | None) -> dict:
    """new / resolved / still_open / escalated against the previous snapshot.

    The snapshot is its own prior state: each one carries the flagged map of the run that
    produced it, and the next build reads the file it is about to replace. A second state
    file would be one more thing to keep in step for no gain.
    """
    return aeh.diff_flagged(list(report.get("flagged") or []), prior_flagged(previous))


# --- the other three queues ---------------------------------------------------


def _gap_item(gap: Mapping) -> dict:
    verdict, why = recommend_gap(gap)
    return {
        "id": gap["id"],
        "queue": "gaps",
        "verbs": GAP_VERBS,
        "caveat": QUEUE_CAVEATS["gaps"],
        "recommended": verdict,
        "recommendation_reason": why,
        "label": gap.get("dashboard_question") or gap["id"],
        "rank": gap.get("rank", 99),
        "count": 1,
        "dismissable": True,
        "dismissed": ({"reason": gap.get("reason") or ""}
                      if gap.get("disposition") == "dismissed" else None),
        "evidence": [{
            "location": gap.get("location"),
            "surface_type": gap.get("surface_type"),
            "judge_reason": gap.get("judge_reason"),
            "rubric_rule": gap.get("rubric_rule"),
            "first_seen": gap.get("first_seen"),
            "last_seen": gap.get("last_seen"),
        }],
    }


def build_gap_queue(gaps: Mapping) -> list[dict]:
    """Untriaged instrumentation gaps, worst rank first. Judged rows go to ``settled``."""
    rows = [g for g in gaps.values() if g.get("disposition") in UNTRIAGED_GAPS]
    rows.sort(key=lambda g: (g.get("rank", 99), g["id"]))
    return [_gap_item(g) for g in rows]


def build_proposal_queue(report: Mapping) -> list[dict]:
    """Watchlist proposals: catalog events in a watched family not yet on the list."""
    return [{
        "id": p["event_type"],
        "queue": "proposals",
        "verbs": PROPOSAL_VERBS,
        "caveat": QUEUE_CAVEATS["proposals"],
        "recommended": "accept",
        "recommendation_reason": (
            "A live event in a watched family that is not on the list. The list exists "
            "to watch this family, so the default is to watch it."
        ),
        "label": p["event_type"],
        "rank": PROPOSAL_RANK,
        "count": 1,
        "dismissable": True,
        "dismissed": None,
        "evidence": [{
            "family": p.get("family"),
            "first_seen_date": p.get("first_seen_date"),
        }],
    } for p in (report.get("proposals") or [])]


def build_alignment_queue(report: Mapping) -> list[dict]:
    """Registry-vs-semantic-layer findings.

    Case 1 is omni being behind the declaration, which is ours to fix and has no dismiss
    (`anchor_alignment`'s own rule). Cases 2 and 3 can be waved off with a `metric:` row.
    """
    return [{
        "id": f.get("key") or f.get("metric"),
        "queue": "alignment",
        "verbs": _verbs(ALIGNMENT_VERBS, f.get("case") != 1),
        "caveat": QUEUE_CAVEATS["alignment"],
        "recommended": ALIGNMENT_RECOMMENDATIONS.get(f.get("case"), ("", ""))[0],
        "recommendation_reason": ALIGNMENT_RECOMMENDATIONS.get(
            f.get("case"), ("", "")
        )[1],
        "label": f"{f.get('metric')}: {f.get('summary') or f.get('case')}",
        "rank": ALIGNMENT_RANK,
        "count": 1,
        "dismissable": f.get("case") != 1,
        "dismissed": None,
        "evidence": [dict(f)],
    } for f in (report.get("anchor_alignment") or [])]


# --- the whole snapshot -------------------------------------------------------


def _settled_gaps(gaps: Mapping) -> list[dict]:
    rows = [g for g in gaps.values() if g.get("disposition") not in UNTRIAGED_GAPS]
    rows.sort(key=lambda g: g["id"])
    return [dict(_gap_item(g), disposition=g.get("disposition")) for g in rows]


def _newest_gap_date(gaps: Mapping) -> str:
    return max((g.get("last_seen") or "" for g in gaps.values()), default="")


def build_snapshot(
    report: Mapping,
    gaps: Mapping,
    explorer: Mapping,
    previous: Mapping | None,
    code: Mapping | None = None,
) -> dict:
    """Join every input into the one file the page renders.

    Refuses a report older than the committed gap state rather than building a snapshot
    that would misreport its own freshness. The report is the only gitignored input, so
    it is the only one that can silently be last week's.
    """
    run_date = report.get("run_date") or ""
    newest_gap = _newest_gap_date(gaps)
    if newest_gap and run_date and run_date < newest_gap:
        raise StaleReport(
            f"health report run_date {run_date} predates the committed gap state "
            f"({newest_gap}); refusing to build a snapshot that would misreport its own "
            "freshness. Download the report for this run first."
        )

    queues = [
        {"queue": "flags", "items": build_flag_queue(report, code)},
        {"queue": "gaps", "items": build_gap_queue(gaps)},
        {"queue": "proposals", "items": build_proposal_queue(report)},
        {"queue": "alignment", "items": build_alignment_queue(report)},
    ]
    overview = build_overview(report, explorer)
    overview["totals"]["open_decisions"] = sum(len(q["items"]) for q in queues)
    cards = build_event_cards(explorer, queue_event_types(queues), code)

    return {
        "run_date": run_date,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "health report + instrumentation gaps + explorer snapshot",
        "overview": overview,
        "changes": build_changes(report, previous),
        # Once at the top, not on every item: the same four sentences on 25 rows is
        # 20 KB of the same four sentences.
        "verb_effects": VERB_EFFECTS,
        "series_weeks": explorer.get("series_weeks") or [],
        "okr_labels": explorer.get("okr_labels") or {},
        "event_cards": cards,
        "queues": queues,
        "settled": _settled_gaps(gaps),
        "prior_flagged": current_flagged_map(report),
    }


# --- CLI ----------------------------------------------------------------------


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--gaps", type=Path, default=GAPS)
    parser.add_argument("--explorer", type=Path, default=EXPLORER)
    parser.add_argument("--code", type=Path, default=CODE_CSV)
    parser.add_argument("-o", "--out", type=Path, required=True)
    args = parser.parse_args(argv)

    for path in (args.report, args.gaps, args.explorer, args.code):
        if not path.exists():
            print(f"missing input: {path}", file=sys.stderr)
            return 1

    previous = _load(args.out) if args.out.exists() else None
    try:
        snapshot = build_snapshot(
            _load(args.report),
            _load(args.gaps),
            _load(args.explorer),
            previous,
            aeh.load_code_axis(args.code),
        )
    except StaleReport as exc:
        print(str(exc), file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(snapshot, indent=1, sort_keys=True) + "\n")
    counts = ", ".join(f"{q['queue']} {len(q['items'])}" for q in snapshot["queues"])
    print(f"wrote {args.out}")
    print(f"  run {snapshot['run_date']}: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
