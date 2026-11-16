"""The nightly cap (TDD "Drafting"; Implementation Notes section 10.7).

Starts at 3 candidates a night and moves on the trailing merge share over the
last two weeks: up to 5 when 70% or more of proposed cases merge, down to 1
or 2 when fewer than 40% do. The TDD names the two triggered values (5, and
"1 or 2") but not the exact split between 1 and 2 — this module picks a
single extra step down (2 below 40%, 1 below 15%) so one bad night doesn't
immediately zero the cap out, while a sustained low merge rate still settles
to the floor the TDD calls out by name.
"""

from datetime import datetime, timedelta

from case_scout.reader.ledger import LedgerEntry

DEFAULT_NIGHTLY_CAP = 3
MERGE_SHARE_TREND_WINDOW_DAYS = 14

_HIGH_MERGE_SHARE = 0.70
_LOW_MERGE_SHARE = 0.40
_VERY_LOW_MERGE_SHARE = 0.15

_CAP_HIGH = 5
_CAP_LOW = 2
_CAP_VERY_LOW = 1

# A single night or two of proposals is too small a sample to move the cap
# off its default — the TDD's own numbers (0-3 severity-3 candidates a
# night) mean even a strong two-week run can have well under ten proposals.
# Below this floor, trailing_merge_share reports None (insufficient data)
# rather than let one or two outlier cases swing the cap to 1 or 5.
MIN_SAMPLE_SIZE = 3


def nightly_cap_for_merge_share(merge_share: float | None) -> int:
    """Maps a trailing merge share to tonight's cap. None (not enough
    proposals yet to have a trend, Implementation Notes 10.7's "starting
    point") keeps the default."""
    if merge_share is None:
        return DEFAULT_NIGHTLY_CAP
    if merge_share >= _HIGH_MERGE_SHARE:
        return _CAP_HIGH
    if merge_share < _VERY_LOW_MERGE_SHARE:
        return _CAP_VERY_LOW
    if merge_share < _LOW_MERGE_SHARE:
        return _CAP_LOW
    return DEFAULT_NIGHTLY_CAP


def trailing_merge_share(
    entries: list[LedgerEntry],
    now: datetime,
    window_days: int = MERGE_SHARE_TREND_WINDOW_DAYS,
) -> float | None:
    """The share of cases proposed in the trailing window that later
    recorded a "merged" ledger line for the same caseId (written by the
    Publisher's outcome reconcile; see ledger.py's module docstring). A
    case whose PR was rejected, auto-closed as stale, or is still open
    counts as not merged. "Merged" lookup is NOT windowed to the same period as
    "proposed" — a case proposed near the window's start may take days to
    review, so its merge can land after the proposal falls out of a purely
    windowed view while still being the right answer to "did this proposal
    merge."

    Returns None when fewer than MIN_SAMPLE_SIZE cases were proposed in the
    window — Implementation Notes 10.7 calls the starting cap "a starting
    point," and a thin sample should not be able to swing it.
    """
    cutoff = now - timedelta(days=window_days)
    proposed = [
        e
        for e in entries
        if e.outcome == "proposed" and e.created_at is not None and e.created_at >= cutoff and e.case_id
    ]
    if len(proposed) < MIN_SAMPLE_SIZE:
        return None

    merged_case_ids = {e.case_id for e in entries if e.outcome == "merged" and e.case_id}
    merged_count = sum(1 for e in proposed if e.case_id in merged_case_ids)
    return merged_count / len(proposed)
