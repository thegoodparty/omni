"""Per-run dollar cap for the Reader's paid Anthropic calls (scoring,
drafting, the PII gate's second read) — ticket (S9, end-to-end wiring)
Implementation Details: "wire it as a config knob with a conservative
placeholder default, not a hardcoded number," since the real number arrives
once Samuel's spend data does (epic card). Same env-var-with-safe-fallback
shape as pipeline.session_cap_from_env, applied to dollars instead of a
session count.

Cost per call is a flat, conservative ESTIMATE, not real per-token
accounting — real per-call cost metering doesn't exist anywhere in this
package yet (reader/main.py's _build_record ships honest zeros for exactly
this reason). This cap exists to bound a genuine runaway (a stuck retry
loop, a marker regression that re-reads weeks of backlog) well before it
could ever approach a real dollar figure, not to meter spend precisely.
"""

import os

DEFAULT_SPEND_CAP_USD = 50.0
SPEND_CAP_ENV = "CASE_SCOUT_SPEND_CAP_USD"

# A worst-case single call: scoring/drafting/gate's own _MAX_TOKENS (2048)
# output plus a generously long transcript input, priced at Opus list rates
# ($15/MTok in, $75/MTok out) — comfortably above what a typical call costs,
# so the cap trips on a genuine runaway well before real spend gets there.
ESTIMATED_COST_PER_CALL_USD = 0.75


def spend_cap_usd_from_env(environ: dict[str, str] | None = None) -> float:
    """CASE_SCOUT_SPEND_CAP_USD, falling back to DEFAULT_SPEND_CAP_USD on
    anything unset, blank, or not a positive number — same fail-safe shape
    as pipeline.session_cap_from_env, so a typo'd env var can't silently
    disable the cap."""
    env = environ if environ is not None else os.environ
    raw = env.get(SPEND_CAP_ENV, "")
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_SPEND_CAP_USD
    return value if value > 0 else DEFAULT_SPEND_CAP_USD


class SpendTracker:
    """Accumulates estimated spend across one Reader run and flags once the
    configured cap is crossed. `record` never raises — callers check the
    return value (or `.cap_hit`) and skip further paid calls themselves,
    the same never-crash-the-pipeline discipline every case_scout module
    keeps."""

    def __init__(self, cap_usd: float):
        self.cap_usd = cap_usd
        self.total_usd = 0.0
        self.by_stage: dict[str, float] = {}
        self.cap_hit = False

    def record(self, stage: str, amount_usd: float = ESTIMATED_COST_PER_CALL_USD) -> bool:
        """Records one call's estimated cost under `stage` ("score", "draft"
        or "gate" — reader/main.py's record.json breakdown) and returns
        whether the run is now over cap (same value as `.cap_hit` right
        after this call, returned for a terse call-site check)."""
        self.total_usd += amount_usd
        self.by_stage[stage] = self.by_stage.get(stage, 0.0) + amount_usd
        if self.total_usd > self.cap_usd:
            self.cap_hit = True
        return self.cap_hit
