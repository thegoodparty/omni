"""L2-to-BallotReady district matcher.

Named after the warehouse objects it reads and writes
(int__l2_br_match_pending_offices, llm_l2_br_match_results) so the dbt side
and the omni side share one vocabulary.

The matcher core -- the district and query embedding text, the menu
construction, the LLM prompt, response schema and Braintrust identifiers --
is an owner-decided constraint, not reviewable, and is reproduced here, not
redesigned. What changed: inputs come from Databricks instead of laptop
pickles, embeddings live in memory for the run and are discarded, and a run
persists only MATCHED and ABSTAINED -- a technical error fails the run
instead of being recorded as a match.

This module writes nothing. `run()` returns terminal results for the caller
to print or inspect; the Databricks write path is a later PR.
"""

import argparse
import asyncio
import functools
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from shared.braintrust import build_cached_prompt, cache_prompt, flush_logs, init_braintrust
from shared.databricks_client import DatabricksClient
from shared.llm_gemini import GeminiEmbeddingClient
from shared.llm_gemini_3 import Gemini3Client, GeminiModelType, ThinkingLevel
from shared.logger import get_logger

PENDING_OFFICES_TABLE = "int__l2_br_match_pending_offices"
DISTRICT_UNIVERSE_TABLE = "int__l2_district_universe"

MATCHED = "MATCHED"
ABSTAINED = "ABSTAINED"

MENU_SIZE = 13
STATE_QUERY_INSERT_INDEX = 10  # 11th slot

# Sized for the LLM client's max_connections=1200 / max_keepalive_connections=300
# below (unchanged, FROZEN). The deleted matcher owned a pool at this same size.
THREAD_POOL_SIZE = 1500

_STATE_CODE_RE = re.compile(r"^[A-Z]{2}$")


@dataclass
class DistrictCandidate:
    """One menu entry: an L2 district.

    l2_state comes from the district's own row in int__l2_district_universe,
    not from the office being matched: a district key is (state, type,
    name), and a position can change state even though the two are equal
    today -- so the source of this field matters even when its value
    doesn't yet.
    """

    l2_state: str
    l2_district_type: str
    l2_district_name: str


@dataclass
class MatchResult:
    """One office's terminal outcome: MATCHED or ABSTAINED, never anything
    else -- a technical error raises instead of producing a MatchResult.

    Carries the six columns this PR is responsible for.
    llm_l2_br_match_results has two more, `run_id` and `attempted_at`, both
    NOT NULL with no default -- those belong to the write path, not here.
    `attempted_at` in particular must NOT default to load time: the
    baseline run stamps it with the date an office was actually matched,
    not today's date, and getting that wrong shifts every 30-day clock. No
    `llm_reason`, no `embeddings`, no `alternative_matches`, no
    `is_exact_district_match`: the results table has no column for any of
    them. l2_state/type/name are None on an ABSTAINED row.
    """

    br_database_id: int
    l2_state: str | None
    l2_district_type: str | None
    l2_district_name: str | None
    match_status: str
    confidence: int | None


@dataclass
class _StateUniverse:
    """One state's embedded district universe, held in memory only and
    never written to disk. Parallel lists, one entry per district row.
    """

    embeddings: np.ndarray
    states: list[str]
    district_types: list[str]
    district_names: list[str]


def _normalize_state(value: Any) -> str:
    """Strip and upper-case, applied on BOTH sides of the universe dict -- the
    worklist state that looks a state up, and the warehouse state that keys it.

    Normalizing one side only moves the bug rather than fixing it, which is
    what the first attempt at this did.

    The old code upper-cased only inside the two SQL WHERE clauses, so a
    lower-case pending `state` keyed the universe dict under 'DE' but was
    looked up as 'de', silently abstaining the entire state while the run
    still exited 0 and reported a 100% abstention rate as though the model
    had judged every office.
    """
    return str(value).strip().upper()


def _validate_pending_offices(pending_df: pd.DataFrame) -> None:
    """Fail closed on a state or a name a later step would otherwise accept
    silently. `state` must already be normalized (see `_normalize_state`).

    A non-canonical state would reach `load_district_universe`'s SQL
    IN-clause unescaped -- that value is warehouse data, not operator
    input, so one apostrophe in it breaks or extends the query. A blank
    name still embeds cleanly (`"race name: "`) and gets back a real,
    arbitrary MATCHED row -- worse than a bad state, because a match is a
    link the pending list's own 30-day rule never reopens.
    """
    bad_state_mask = ~pending_df["state"].str.match(_STATE_CODE_RE)
    if bad_state_mask.any():
        bad_states = sorted(pending_df.loc[bad_state_mask, "state"].unique())
        raise ValueError(f"Pending offices carry a non-canonical state code: {bad_states}")

    blank_name_mask = pending_df["name"].fillna("").str.strip() == ""
    if blank_name_mask.any():
        raise ValueError(f"{int(blank_name_mask.sum())} pending office(s) have a blank or null name")


def _district_embedding_text(state: str, district_type: str, district_name: str) -> str:
    """FROZEN (vector_store_generator.py's create_embedding_texts). Reproduce
    character-for-character, including the spacing and punctuation: this text
    is what gets embedded, so a drift here silently changes every similarity
    score and every match against the January holdout.
    """
    return f"state: {state}, district type: {district_type}, district name: {district_name}"


def _require_integral(value: Any, field_name: str) -> int:
    """Reject a bool, a non-numeric type, a non-finite float, and any value
    that is not a whole number; return a clean `int` otherwise.

    A bool is an `int` subclass in Python, so `isinstance(value, bool)` must
    be checked ahead of the general numeric check, or `True` would silently
    pass as `1`. The response schema declares both the selection and the
    confidence as a bare "number", and the LLM client does no client-side
    validation of its own, so `3.9` would otherwise truncate to `3` --
    silently recording the model's 4th choice as its 3rd -- and a string
    like `'95'` would pass straight through into a column typed as an
    integer.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} must be a non-boolean numeric value: {value!r}")
    if not math.isfinite(value):
        raise ValueError(f"{field_name} must be finite: {value!r}")
    if not float(value).is_integer():
        raise ValueError(f"{field_name} must be a whole number: {value!r}")
    return int(value)


def _selection_from_response(response: dict[str, Any], num_candidates: int) -> tuple[int, int]:
    """Extract (selected index, confidence) from a raw LLM response.

    Raises ValueError on a missing, non-numeric, non-integral, boolean, or
    out-of-range value for either field. An abstention (index 0) is a
    judgment the model made and closes the office on the pending list for
    30 days; a schema violation is not a judgment, so it must fail the run
    rather than being coerced into an abstention.

    Both response reads sit in the same try block, so the raise happens
    before either key is read individually and before a `None` response
    (TypeError on subscript) reaches any attribute access -- a guard that
    caught a bad index and then read a second key unguarded right after is
    what this replaces.
    """
    try:
        selected_index = _require_integral(response["selected_candidate_number"], "selected_candidate_number")
        confidence = _require_integral(response["selection_confidence"], "selection_confidence")
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Malformed LLM response, expected a numeric selection and confidence: {response!r}") from exc

    if not 0 <= selected_index <= num_candidates:
        raise ValueError(f"selected_candidate_number {selected_index} out of bounds for {num_candidates} candidates")
    if not 0 <= confidence <= 100:
        raise ValueError(f"selection_confidence {confidence} out of bounds [0, 100]")

    return selected_index, confidence


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError(f"must be a positive integer, got {value!r}")
    return parsed


class L2BrMatcher:
    """Matches BallotReady offices to L2 districts. See module docstring for
    what is frozen and what changed in this PR.
    """

    def __init__(self, catalog: str = "goodparty_data_catalog", schema: str = "dbt"):
        self.logger = get_logger(__name__)
        self.databricks = DatabricksClient()

        target_concurrency = 1200
        self.llm = Gemini3Client(
            default_model=GeminiModelType.FLASH_3,
            default_temperature=0.0,
            thinking_level=ThinkingLevel.MINIMAL,
            max_connections=target_concurrency,
            max_keepalive_connections=target_concurrency // 4,
            max_retries=11,
            base_delay=1.0,
        )
        self.embedding_client = GeminiEmbeddingClient(max_retries=11, base_delay=1.0)

        # An explicit pool, not the loop's default executor (asyncio.to_thread's
        # min(32, cpu_count + 4)), so the httpx pool above actually sees the
        # concurrency it is sized for.
        self._executor = ThreadPoolExecutor(max_workers=THREAD_POOL_SIZE)

        # Both clients report a LIFETIME cumulative total and are constructed
        # fresh just above, so this is always 0.0 here -- run() takes the real
        # snapshot at its own start, since a construction-time baseline would
        # make a second run() on this instance report the first run's spend too.
        self._embedding_cost_baseline = 0.0
        self._llm_cost_baseline = 0.0

        self.pending_offices_path = f"{catalog}.{schema}.{PENDING_OFFICES_TABLE}"
        self.district_universe_path = f"{catalog}.{schema}.{DISTRICT_UNIVERSE_TABLE}"

        self._universe_by_state: dict[str, _StateUniverse] = {}

        init_braintrust(project="stitch-golden-data")
        self._init_prompt_cache()

    def _init_prompt_cache(self) -> None:
        self._prompt_name = "stitch-golden-data-matcher"
        prompt_obj = cache_prompt(self._prompt_name)
        if prompt_obj is not None:
            self.logger.info("Braintrust prompt cached for stitch-golden-data-matcher")
        else:
            self.logger.warning("Braintrust prompt not available, using fallback")

    async def _run_in_pool(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Dispatch a blocking call through this instance's own thread pool,
        never the event loop's default executor -- see the pool-sizing
        comment in __init__.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, functools.partial(func, *args, **kwargs))

    # -- Read path -----------------------------------------------------

    def load_pending_offices(self, states: list[str] | None = None, limit: int | None = None) -> pd.DataFrame:
        """Read the worklist. Exactly the three columns this PR needs -- the
        geography columns exist on the table but belong to the next PR.

        Deterministic order (by br_database_id): with no ORDER BY, `--limit
        N` would return a different N offices on every invocation, and
        comparability against the January holdout is what this work is
        measured on.

        State values are normalized (see `_normalize_state`) and validated
        (see `_validate_pending_offices`) here, since this is the sole
        place any caller reads them.
        """
        where_clause = ""
        if states:
            states_str = "', '".join(_normalize_state(s) for s in states)
            where_clause = f"where state in ('{states_str}')"
        limit_clause = f"limit {limit}" if limit is not None else ""

        query = f"""
        select br_database_id, name, state
        from {self.pending_offices_path}
        {where_clause}
        order by br_database_id
        {limit_clause}
        """
        pending_df = self.databricks.execute_query(query)
        if pending_df.empty:
            return pending_df

        pending_df = pending_df.copy()
        pending_df["state"] = pending_df["state"].map(_normalize_state)
        _validate_pending_offices(pending_df)
        return pending_df

    def load_district_universe(self, states: list[str]) -> pd.DataFrame:
        """Read the menu source for exactly the states the worklist needs."""
        states_str = "', '".join(s.upper() for s in states)
        query = f"""
        select state_postal_code, district_type, district_name
        from {self.district_universe_path}
        where state_postal_code in ('{states_str}')
        """
        return self.databricks.execute_query(query)

    async def build_universe(self, states: list[str], embedding_batch_size: int) -> None:
        """Read and embed int__l2_district_universe for exactly these
        states, held in memory only.
        """
        if not states:
            return
        universe_df = self.load_district_universe(states)
        # Normalized on BOTH sides. The pending side alone is not enough: this key
        # comes straight off the warehouse, and normalizing only the lookup leaves the
        # same asymmetry pointing the other way.
        for state, group in universe_df.groupby("state_postal_code"):
            await self._embed_state_universe(_normalize_state(state), group, embedding_batch_size)

    async def _embed_state_universe(self, state: str, district_rows: pd.DataFrame, embedding_batch_size: int) -> None:
        """Embed one state's district universe, batched (FROZEN:
        parallel=True), dispatched through this instance's own thread pool.

        `create_embeddings` does `asyncio.run(...)` internally for any
        multi-text input (shared/llm_gemini.py:941), and every state's
        universe has at least two rows (real districts plus the synthetic
        `district_type='State'` row) -- so calling it directly from this
        coroutine would raise `RuntimeError: asyncio.run() cannot be called
        from a running event loop`. vector_store_generator.py:204 is the
        only other caller of this same document path and already wraps the
        identical call in a thread for exactly this reason.

        The column-name trap: the embedding text is assembled from three
        values in a fixed order, so a positional read that silently swaps
        two of them would produce a plausible string and a different
        embedding. Read each column by its explicit name.
        """
        states: list[str] = []
        district_types: list[str] = []
        district_names: list[str] = []
        texts: list[str] = []
        for _, row in district_rows.iterrows():
            row_state = row["state_postal_code"]
            row_district_type = row["district_type"]
            row_district_name = row["district_name"]
            states.append(row_state)
            district_types.append(row_district_type)
            district_names.append(row_district_name)
            texts.append(_district_embedding_text(row_state, row_district_type, row_district_name))

        # vector_store_generator.py:204 is the only other caller of this
        # document path and passes these same values for the same workload.
        # The client defaults (max_concurrent_batches=2, rate_limit_delay=2.0)
        # would make a national build thousands of batches at two-way
        # concurrency behind two-second sleeps.
        embeddings = await self._run_in_pool(
            self.embedding_client.create_embeddings,
            texts,
            parallel=True,
            batch_size=embedding_batch_size,
            max_concurrent_batches=800,
            rate_limit_delay=0.01,
        )
        self._universe_by_state[state] = _StateUniverse(
            embeddings=embeddings,
            states=states,
            district_types=district_types,
            district_names=district_names,
        )

    # -- Matcher core (FROZEN, owner-decided, not reviewable) -----------

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    async def _embed_query_texts(self, queries: list[str]) -> list[np.ndarray]:
        """Embed each query with its own create_embeddings call, one text
        per call -- never batch these.

        create_embeddings dispatches purely on `len(texts) == 1`
        (shared/llm_gemini.py:937): a multi-text call routes through
        _create_embeddings_parallel, which sets taskType=RETRIEVAL_DOCUMENT
        (shared/llm_gemini.py:831, the file's only occurrence); a
        single-text call goes to _create_single_embedding, which sets no
        taskType. The `parallel`/`batch_size` arguments play no part in that
        choice. So documents live in RETRIEVAL_DOCUMENT space and queries
        live in the default space, and the only thing keeping a query out of
        RETRIEVAL_DOCUMENT space is that its call has exactly one text.
        Batching these -- the obvious speedup, since sending one query per
        office is slow -- would silently move every query into the other
        space and change every similarity score. Nothing would raise; both
        spaces are 3072-dimensional.
        """
        embeddings = []
        for query in queries:
            result = await self._run_in_pool(self.embedding_client.create_embeddings, [query])
            embeddings.append(result[0])
        return embeddings

    async def _build_menu(self, br_name: str, state: str) -> list[DistrictCandidate]:
        """Build the up-to-13-candidate menu for one office.

        FROZEN, owner-decided and not reviewable: top 13 by cosine on the
        race name, then the best hit for the bare "state" query is inserted
        at index 10 (the 11th slot) if it is not already among the race
        results, then the list is truncated back to 13. A heuristic, not a
        guarantee. Do not "fix" it.

        Raises if `state` has no built universe entry. A missing input is
        an infrastructure failure, not a judgment: returning an empty menu
        here would abstain the office and close it on the pending list for
        30 days over a bug, not a model decision.
        """
        state_universe = self._universe_by_state.get(state)
        if state_universe is None:
            raise ValueError(f"No district universe built for state {state!r}; cannot build a menu")

        race_query = f"race name: {br_name}"
        state_query = "state"
        race_query_embedding, state_query_embedding = await self._embed_query_texts([race_query, state_query])

        embeddings = state_universe.embeddings

        def _candidate(idx: int) -> DistrictCandidate:
            return DistrictCandidate(
                l2_state=state_universe.states[idx],
                l2_district_type=state_universe.district_types[idx],
                l2_district_name=state_universe.district_names[idx],
            )

        race_similarities = sorted(
            ((self._cosine_similarity(race_query_embedding, embeddings[i]), i) for i in range(len(embeddings))),
            reverse=True,
        )
        race_results = race_similarities[:MENU_SIZE]
        race_indices = {i for _, i in race_results}
        candidates = [_candidate(idx) for _, idx in race_results]

        state_similarities = sorted(
            ((self._cosine_similarity(state_query_embedding, embeddings[i]), i) for i in range(len(embeddings))),
            reverse=True,
        )

        if len(candidates) >= 11 and state_similarities:
            _, state_idx = state_similarities[0]
            if state_idx not in race_indices:
                candidates.insert(STATE_QUERY_INSERT_INDEX, _candidate(state_idx))
                candidates = candidates[:MENU_SIZE]

        return candidates

    async def _select_candidate(self, br_name: str, candidates: list[DistrictCandidate]) -> dict[str, Any]:
        """Ask the LLM to pick a candidate. FROZEN: prompt, schema, trace
        name. Never catches -- an LLM failure must fail the run, not be
        delivered as a match.
        """
        district_descriptions = [
            f"{i}. {c.l2_district_name} ({c.l2_district_type})" for i, c in enumerate(candidates, 1)
        ]
        districts_text = "\n".join(district_descriptions)
        state = candidates[0].l2_state if candidates else "Unknown"
        num_districts = str(len(candidates))

        variables = {
            "br_name": br_name,
            "state": state,
            "districts_text": districts_text,
            "num_districts": num_districts,
        }

        fallback_prompt = f"""
You are analyzing a political position to find the best L2 district match from candidate districts.

BR Position Details:
- Name: "{br_name}"
- State: {state}

Top {num_districts} District Candidates:
{districts_text}

Analyze the BR position and select the BEST matching candidate. Consider:
- Geographic alignment (city/county matching)
- Office type and district type compatibility
- Specific identifiers or numbers in names
- Functional role alignment (e.g., School Board → School Board districts)
- Ignore seats and positions
- if the office is greater than the state level, match to the state level

Return JSON with:
• selected_candidate_number: Number (1-{num_districts}) of your choice, or 0 if no good match
• selection_confidence: Confidence level (0-100)
• reasoning: Detailed explanation of your selection or rejection
• close_alternatives: Array of candidate numbers that were very close (only if multiple options were neck-and-neck)
• is_exact_district_match: Boolean indicating whether the selected candidate matches the BR position at the same specificity level. Set true if the selected L2 candidate is at the same district specificity as the BR position (e.g., "City Council District 3" matched to a district-level L2 entry). Set false if the BR position specifies a sub-district (Ward, District, Place + number) but the selected L2 candidate is a parent-level type (City, County, Township, Borough, Village, Town_District). Set false if selected_candidate_number is 0.

IMPORTANT: Return 0 if no candidate represents a reasonable match.
There is a real probability that the match does not exist so return 0 if there is no clear match.

Base decisions on semantic meaning, geography, and functional appropriateness.
"""

        prompt = build_cached_prompt(self._prompt_name, variables, fallback_prompt=fallback_prompt)
        if not prompt:
            prompt = fallback_prompt

        response_schema = {
            "type": "object",
            "properties": {
                "selected_candidate_number": {"type": "number", "minimum": 0, "maximum": len(candidates)},
                "selection_confidence": {"type": "number", "minimum": 0, "maximum": 100},
                "reasoning": {"type": "string"},
                "close_alternatives": {
                    "type": "array",
                    "items": {"type": "number", "minimum": 0, "maximum": len(candidates)},
                },
                "is_exact_district_match": {"type": "boolean"},
            },
            "required": ["selected_candidate_number", "selection_confidence", "reasoning", "is_exact_district_match"],
        }

        return await self._run_in_pool(
            self.llm.generate_structured_content,
            prompt=prompt,
            response_schema=response_schema,
            trace_name="stitch-match-selection",
        )

    # -- Terminal-status contract: MATCHED or ABSTAINED, or raise --------

    async def match_office(self, br_database_id: int, br_name: str, state: str) -> MatchResult:
        """Match one BR office to an L2 district, or abstain.

        Persists only MATCHED and ABSTAINED. Never converts an LLM or
        embedding failure into a result -- it propagates so the run fails
        instead of being recorded as a match (the old
        `selected_district_name == "LLM_ERROR"` bug this replaces).
        """
        candidates = await self._build_menu(br_name, state)

        # Reserved for a later PR's geography filters, which can legitimately
        # empty a menu (no eligible district type) -- that is a judgment, not
        # an infrastructure failure, and abstains before the LLM is called.
        # _build_menu never returns an empty list today; it raises instead,
        # because nothing yet empties a menu this way.
        if not candidates:
            return MatchResult(br_database_id, None, None, None, ABSTAINED, None)

        response = await self._select_candidate(br_name, candidates)
        selected_index, confidence = _selection_from_response(response, len(candidates))

        if selected_index == 0:
            return MatchResult(br_database_id, None, None, None, ABSTAINED, confidence)

        selected = candidates[selected_index - 1]
        return MatchResult(
            br_database_id=br_database_id,
            l2_state=selected.l2_state,
            l2_district_type=selected.l2_district_type,
            l2_district_name=selected.l2_district_name,
            match_status=MATCHED,
            confidence=confidence,
        )

    # -- Orchestration and dry run ---------------------------------------

    async def run(
        self,
        states: list[str] | None = None,
        limit: int | None = None,
        batch_size: int = 100,
        embedding_batch_size: int = 100,
    ) -> list[MatchResult]:
        """Match the pending worklist. Writes nothing -- this returns
        terminal results for the caller to print or persist.

        Takes the cost-baseline snapshot here, not at construction: see the
        comment in __init__.
        """
        self._embedding_cost_baseline = self.embedding_client.get_cost_stats()["total_cost"]
        self._llm_cost_baseline = self.llm.get_usage_stats()["total_cost"]

        try:
            pending_df = self.load_pending_offices(states=states, limit=limit)
            if pending_df.empty:
                self.logger.warning("No pending offices matched the given filters")
                return []

            worklist_states = sorted(pending_df["state"].unique())
            self.logger.info(f"Building the district universe for {len(worklist_states)} state(s)")
            await self.build_universe(worklist_states, embedding_batch_size)

            missing_states = [s for s in worklist_states if s not in self._universe_by_state]
            if missing_states:
                raise ValueError(f"No district universe entry for state(s): {missing_states}")

            offices = list(pending_df.itertuples(index=False))
            results: list[MatchResult] = []
            for batch_start in range(0, len(offices), batch_size):
                batch = offices[batch_start : batch_start + batch_size]
                batch_results = await asyncio.gather(
                    *(self.match_office(office.br_database_id, office.name, office.state) for office in batch)
                )
                results.extend(batch_results)
                self.logger.info(f"Matched {len(results)}/{len(offices)} offices")

            return results
        except Exception:
            embedding_cost, llm_cost = self._cost_deltas()
            self.logger.error(
                f"Run failed. Partial cost before failure -- embedding: ${embedding_cost:.6f}, "
                f"LLM: ${llm_cost:.6f}, total: ${embedding_cost + llm_cost:.6f}"
            )
            raise

    def _cost_deltas(self) -> tuple[float, float]:
        """This run's (embedding_cost, llm_cost). Both clients report a
        lifetime cumulative total, so this is always a delta against the
        baseline `run()` takes at its own start.
        """
        embedding_cost = self.embedding_client.get_cost_stats()["total_cost"] - self._embedding_cost_baseline
        llm_cost = self.llm.get_usage_stats()["total_cost"] - self._llm_cost_baseline
        return embedding_cost, llm_cost

    def print_summary(self, results: list[MatchResult]) -> None:
        """Print counts by match_status and this run's cost."""
        matched = sum(1 for r in results if r.match_status == MATCHED)
        abstained = sum(1 for r in results if r.match_status == ABSTAINED)
        embedding_cost, llm_cost = self._cost_deltas()

        self.logger.info(f"Processed {len(results)} offices")
        self.logger.info(f"  {MATCHED}: {matched}")
        self.logger.info(f"  {ABSTAINED}: {abstained}")
        self.logger.info(f"Embedding cost: ${embedding_cost:.6f}")
        self.logger.info(f"LLM cost: ${llm_cost:.6f}")
        self.logger.info(f"Total cost: ${embedding_cost + llm_cost:.6f}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Match BallotReady offices to L2 districts. Dry run: writes nothing.")
    parser.add_argument("--states", nargs="+", type=str, help="Limit to these state codes (e.g. --states DE CA)")
    parser.add_argument("--limit", type=_positive_int, help="Limit the number of pending offices read (positive)")
    parser.add_argument(
        "--batch-size",
        type=_positive_int,
        default=100,
        help="Offices matched concurrently per group (positive; default: 100)",
    )
    parser.add_argument(
        "--embedding-batch-size",
        type=_positive_int,
        default=100,
        help="District texts embedded per call when building the universe (positive; default: 100)",
    )
    return parser.parse_args(argv)


async def main() -> None:
    args = _parse_args()
    matcher = L2BrMatcher()
    try:
        results = await matcher.run(
            states=args.states,
            limit=args.limit,
            batch_size=args.batch_size,
            embedding_batch_size=args.embedding_batch_size,
        )
        matcher.print_summary(results)
    finally:
        flush_logs()


if __name__ == "__main__":
    asyncio.run(main())
