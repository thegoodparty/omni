"""L2-to-BallotReady district matcher.

Named after the warehouse objects it reads and writes
(int__l2_br_match_pending_offices, llm_l2_br_match_results) so the dbt side
and the omni side share one vocabulary.

The matcher core -- the district and query embedding text, the menu
construction, the LLM prompt, response schema and Braintrust identifiers --
is an owner-decided constraint (SPEC 3.1: "That part works, and v1 does not
touch it") and is reproduced here, not redesigned. What changed: inputs come
from Databricks instead of laptop pickles, embeddings live in memory for the
run and are discarded, and a run persists only MATCHED and ABSTAINED
(SPEC 3.4) -- a technical error fails the run instead of being recorded as a
match.

This module writes nothing. `run()` returns terminal results for the caller
to print or inspect; the Databricks write path is a later PR.
"""

import argparse
import asyncio
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
STATE_QUERY_INSERT_INDEX = 10  # 11th slot (SPEC 3.1)


@dataclass
class DistrictCandidate:
    """One menu entry: an L2 district plus its cosine similarity to a query.

    l2_state comes from the district's own row in int__l2_district_universe,
    not from the office being matched. SPEC 3.4: a district key is
    (state, type, name), and a position can change state even though the two
    are equal today -- so the source of this field matters even when its
    value doesn't yet.
    """

    l2_state: str
    l2_district_type: str
    l2_district_name: str
    similarity_score: float


@dataclass
class MatchResult:
    """One office's terminal outcome.

    Exactly the columns llm_l2_br_match_results (T1 PR C) writes -- no
    llm_reason, no embeddings, no alternative_matches, no
    is_exact_district_match: the results table has no column for any of
    them. l2_state/type/name are None on an ABSTAINED row.
    """

    br_database_id: int
    l2_state: str | None
    l2_district_type: str | None
    l2_district_name: str | None
    match_status: str
    confidence: float | None


@dataclass
class _StateUniverse:
    """One state's embedded district universe, held in memory only (SPEC
    3.5: embeddings are never stored). Parallel lists, one entry per
    district row.
    """

    embeddings: np.ndarray
    states: list[str]
    district_types: list[str]
    district_names: list[str]


def _district_embedding_text(state: str, district_type: str, district_name: str) -> str:
    """FROZEN (vector_store_generator.py's create_embedding_texts). Reproduce
    character-for-character, including the spacing and punctuation: this text
    is what gets embedded, so a drift here silently changes every similarity
    score and every match against the January holdout.
    """
    return f"state: {state}, district type: {district_type}, district name: {district_name}"


def _selection_from_response(response: dict[str, Any], num_candidates: int) -> tuple[int, float]:
    """Extract (selected index, confidence) from a raw LLM response.

    Raises ValueError on a missing, non-numeric, or out-of-[0, num_candidates]
    index. SPEC 3.4: an abstention (index 0) is a judgment the model made and
    closes the office on the pending list for 30 days; a schema violation is
    not a judgment, so it must fail the run rather than being coerced into
    ABSTAINED.

    Both response reads sit in the same try block, so the raise happens
    before either key is read individually and before a `None` response
    (TypeError on subscript) reaches any attribute access -- the old code's
    guard caught a bad index, then read two more keys unguarded right after.
    """
    try:
        selected_index = int(float(response["selected_candidate_number"]))
        confidence = response["selection_confidence"]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Malformed LLM response, expected a numeric selection and confidence: {response!r}") from exc

    if not 0 <= selected_index <= num_candidates:
        raise ValueError(f"selected_candidate_number {selected_index} out of bounds for {num_candidates} candidates")

    return selected_index, confidence


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

        # Both clients expose a LIFETIME cumulative total (shared/llm_gemini.py:696 does
        # `self.total_cost += cost` and never resets), not a per-call or per-run figure.
        # Snapshotting it here and taking a delta in print_summary is what
        # vector_store_generator.py:202 does correctly (`final_cost - initial_cost`) and
        # what the old production_matcher.py's per-state stats object did not: it assigned
        # the running cumulative total into each state's stats and then summed those across
        # states, so state 1's cost was re-added on every subsequent state.
        self._embedding_cost_baseline = self.embedding_client.get_cost_stats()["total_cost"]
        self._llm_cost_baseline = self.llm.get_usage_stats()["total_cost"]

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

    # -- Read path -----------------------------------------------------

    def load_pending_offices(self, states: list[str] | None = None, limit: int | None = None) -> pd.DataFrame:
        """Read the worklist. Exactly the three columns this PR needs -- the
        geography columns exist on the table but belong to the next PR.
        """
        where_clause = ""
        if states:
            states_str = "', '".join(s.upper() for s in states)
            where_clause = f"where state in ('{states_str}')"
        limit_clause = f"limit {limit}" if limit else ""

        query = f"""
        select br_database_id, name, state
        from {self.pending_offices_path}
        {where_clause}
        {limit_clause}
        """
        return self.databricks.execute_query(query)

    def load_district_universe(self, states: list[str]) -> pd.DataFrame:
        """Read the menu source for exactly the states the worklist needs."""
        states_str = "', '".join(s.upper() for s in states)
        query = f"""
        select state_postal_code, district_type, district_name
        from {self.district_universe_path}
        where state_postal_code in ('{states_str}')
        """
        return self.databricks.execute_query(query)

    def build_universe(self, states: list[str], batch_size: int) -> None:
        """Read and embed int__l2_district_universe for exactly these
        states, held in memory only.
        """
        if not states:
            return
        universe_df = self.load_district_universe(states)
        for state, group in universe_df.groupby("state_postal_code"):
            self._embed_state_universe(state, group, batch_size)

    def _embed_state_universe(self, state: str, district_rows: pd.DataFrame, batch_size: int) -> None:
        """Embed one state's district universe, batched (FROZEN:
        parallel=True), and hold the vectors in memory only.

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

        embeddings = self.embedding_client.create_embeddings(texts, parallel=True, batch_size=batch_size)
        self._universe_by_state[state] = _StateUniverse(
            embeddings=embeddings,
            states=states,
            district_types=district_types,
            district_names=district_names,
        )

    # -- Matcher core (FROZEN, SPEC 3.1) --------------------------------

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
            result = await asyncio.to_thread(self.embedding_client.create_embeddings, [query])
            embeddings.append(result[0])
        return embeddings

    async def _build_menu(self, br_name: str, state: str) -> list[DistrictCandidate]:
        """Build the up-to-13-candidate menu for one office.

        FROZEN (SPEC 3.1, owner-decided, not reviewable): top 13 by cosine
        on the race name, then the best hit for the bare "state" query is
        inserted at index 10 (the 11th slot) if it is not already among the
        race results, then the list is truncated back to 13. A heuristic,
        not a guarantee -- SPEC 3.1 says so explicitly. Do not "fix" it.
        """
        state_universe = self._universe_by_state.get(state)
        if state_universe is None:
            return []

        race_query = f"race name: {br_name}"
        state_query = "state"
        query_embeddings = await self._embed_query_texts([race_query, state_query])
        if len(query_embeddings) < 2:
            return []
        race_query_embedding, state_query_embedding = query_embeddings

        embeddings = state_universe.embeddings

        def _candidate(score: float, idx: int) -> DistrictCandidate:
            return DistrictCandidate(
                l2_state=state_universe.states[idx],
                l2_district_type=state_universe.district_types[idx],
                l2_district_name=state_universe.district_names[idx],
                similarity_score=score,
            )

        race_similarities = sorted(
            ((self._cosine_similarity(race_query_embedding, embeddings[i]), i) for i in range(len(embeddings))),
            reverse=True,
        )
        race_results = race_similarities[:MENU_SIZE]
        race_indices = {i for _, i in race_results}
        candidates = [_candidate(score, idx) for score, idx in race_results]

        state_similarities = sorted(
            ((self._cosine_similarity(state_query_embedding, embeddings[i]), i) for i in range(len(embeddings))),
            reverse=True,
        )

        if len(candidates) >= 11 and state_similarities:
            state_score, state_idx = state_similarities[0]
            if state_idx not in race_indices:
                candidates.insert(STATE_QUERY_INSERT_INDEX, _candidate(state_score, state_idx))
                candidates = candidates[:MENU_SIZE]

        return candidates

    async def _select_candidate(self, br_name: str, candidates: list[DistrictCandidate]) -> dict[str, Any]:
        """Ask the LLM to pick a candidate. FROZEN: prompt, schema, trace
        name (SPEC 3.1). Never catches -- an LLM failure must fail the run
        (SPEC 3.4), not be delivered as a match.
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

        return await asyncio.to_thread(
            self.llm.generate_structured_content,
            prompt=prompt,
            response_schema=response_schema,
            trace_name="stitch-match-selection",
        )

    # -- Terminal-status contract (SPEC 3.4, NEW) -----------------------

    async def match_office(self, br_database_id: int, br_name: str, state: str) -> MatchResult:
        """Match one BR office to an L2 district, or abstain.

        Persists only MATCHED and ABSTAINED. Never converts an LLM or
        embedding failure into a result -- it propagates so the run fails
        instead of being recorded as a match (the old
        `selected_district_name == "LLM_ERROR"` bug this replaces).
        """
        candidates = await self._build_menu(br_name, state)

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
        self, states: list[str] | None = None, limit: int | None = None, batch_size: int = 100
    ) -> list[MatchResult]:
        """Match the pending worklist. Writes nothing -- this returns
        terminal results for the caller to print or persist.
        """
        pending_df = self.load_pending_offices(states=states, limit=limit)
        if pending_df.empty:
            self.logger.warning("No pending offices matched the given filters")
            return []

        worklist_states = sorted(pending_df["state"].dropna().unique())
        self.logger.info(f"Building the district universe for {len(worklist_states)} state(s)")
        self.build_universe(worklist_states, batch_size)

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

    def print_summary(self, results: list[MatchResult]) -> None:
        """Print counts by match_status and this run's cost.

        Both clients report a lifetime cumulative total, not a per-run one
        (see the baseline comment in __init__), so this reports the delta
        against the baseline taken at construction rather than the raw
        totals -- reading the raw totals is the old code's ~26x overstatement
        bug.
        """
        matched = sum(1 for r in results if r.match_status == MATCHED)
        abstained = sum(1 for r in results if r.match_status == ABSTAINED)
        embedding_cost = self.embedding_client.get_cost_stats()["total_cost"] - self._embedding_cost_baseline
        llm_cost = self.llm.get_usage_stats()["total_cost"] - self._llm_cost_baseline

        self.logger.info(f"Processed {len(results)} offices")
        self.logger.info(f"  {MATCHED}: {matched}")
        self.logger.info(f"  {ABSTAINED}: {abstained}")
        self.logger.info(f"Embedding cost: ${embedding_cost:.6f}")
        self.logger.info(f"LLM cost: ${llm_cost:.6f}")
        self.logger.info(f"Total cost: ${embedding_cost + llm_cost:.6f}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Match BallotReady offices to L2 districts. Dry run: writes nothing.")
    parser.add_argument("--states", nargs="+", type=str, help="Limit to these state codes (e.g. --states DE CA)")
    parser.add_argument("--limit", type=int, help="Limit the number of pending offices read")
    parser.add_argument(
        "--batch-size", type=int, default=100, help="Offices matched concurrently per group (default: 100)"
    )
    return parser.parse_args(argv)


async def main() -> None:
    args = _parse_args()
    matcher = L2BrMatcher()
    try:
        results = await matcher.run(states=args.states, limit=args.limit, batch_size=args.batch_size)
        matcher.print_summary(results)
    finally:
        flush_logs()


if __name__ == "__main__":
    asyncio.run(main())
