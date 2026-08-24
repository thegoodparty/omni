"""Databricks write path and run lifecycle for the L2-to-BallotReady matcher.

Four small, separately-callable operations over the two tables T1 created
outside dbt (dbt/scripts/llm_l2_br_match_tables.sql) and reads only as
sources: create a run, append its results, complete it, or revoke it plus
every run sequenced after it. The supervised cutover drives these by hand --
a human reviews the rows a run just wrote before deciding to complete it
(SPEC 3.4 step 3).

Lives beside the matcher, not in shared/: shared/ is imported by every other
service in this package and held to mypy's strict disallow_untyped_defs, so
giving it its first write capability for one caller is a blast radius this
module avoids by depending on shared.databricks_client.DatabricksClient
rather than becoming part of it. shared/ is not modified.

Per-row validation here is the ONLY enforcement `status` and `match_status`
get: neither column carries a CHECK constraint (a deliberate ledger
decision -- SPEC 3.5 puts the guard in the container instead), and Unity
Catalog PRIMARY KEY / UNIQUE constraints on this schema are informational,
not enforced. `sequence` is the one exception: Delta itself refuses an
explicit write to a `generated always as identity` column, which is why
that column never appears in any INSERT below.

`append_results` is single-shot per run (refuses a run that already has
rows) and `complete_run` runs the set-level invariants itself: the
connector has no transactions (`Connection.commit()` is a documented no-op,
`rollback()` raises `NotSupportedError`), so a retry after a partial
failure, or an operator who forgets a separate verification step, are both
real ways to publish something wrong. See append_results' and
complete_run's own docstrings.
"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

from databricks.sql.client import Cursor

from shared.databricks_client import DatabricksClient
from shared.logger import get_logger
from stitch_golden_data.prod_gold_data.l2_br_matcher import ABSTAINED, MATCHED, MatchResult

CATALOG = "goodparty_data_catalog"
MODEL_PREDICTIONS_SCHEMA = "model_predictions"
RUNS_TABLE = "llm_l2_br_match_runs"
RESULTS_TABLE = "llm_l2_br_match_results"
DISTRICT_UNIVERSE_SCHEMA = "dbt"
DISTRICT_UNIVERSE_TABLE = "int__l2_district_universe"

RUNNING = "RUNNING"
COMPLETE = "COMPLETE"
REVOKED = "REVOKED"

# 8 columns x 500 rows/statement = 4,000 bound parameters per INSERT, well
# inside one request. ceil(20,166 / 500) = 41 round trips for the measured
# backlog (IMPLEMENTATION-LEDGER, "the number the cutover rests on"). Not
# tuned against a live warehouse. Verified directly (fix-round review
# question): 4,000 positional parameters, shaped exactly like this INSERT
# (500 groups of 8), bind and execute cleanly over the same connector
# version and the same default (Thrift) backend this module uses -- a
# read-only `SELECT count(*) FROM (VALUES ...)` touching no table, run by
# hand against the real warehouse. No 256-parameter ceiling exists for
# positional markers here.
RESULTS_INSERT_CHUNK_SIZE = 500


@dataclass
class ResultRow:
    """One llm_l2_br_match_results row about to be written: a MatchResult
    plus the two columns the write path owns rather than the matcher (see
    MatchResult's own docstring) -- `run_id`, generated before any row
    exists to carry it, and `attempted_at`, the column the 30-day pending
    clock reads.
    """

    run_id: str
    br_database_id: int
    l2_state: str | None
    l2_district_type: str | None
    l2_district_name: str | None
    match_status: str
    confidence: int | None
    attempted_at: datetime


def _to_result_rows(run_id: str, results: list[MatchResult], attempted_at: datetime) -> list[ResultRow]:
    """Tag a batch of matcher output with the two columns it does not carry.

    One `attempted_at` for the whole call, not one per office: a live run's
    offices are all matched inside one bounded window, and the 30-day
    pending clock does not need finer resolution than that. The caller
    supplies the value explicitly rather than this function defaulting to
    its own `datetime.now()`, so a bug that calls `append_results` twice for
    what is conceptually one attempt cannot silently mint two different
    timestamps.
    """
    return [
        ResultRow(
            run_id=run_id,
            br_database_id=r.br_database_id,
            l2_state=r.l2_state,
            l2_district_type=r.l2_district_type,
            l2_district_name=r.l2_district_name,
            match_status=r.match_status,
            confidence=r.confidence,
            attempted_at=attempted_at,
        )
        for r in results
    ]


def validate_result_rows(rows: list[ResultRow]) -> None:
    """Per-row validation over the WHOLE batch, before the first insert
    (SPEC 3.5). Raises ValueError naming every failing row and why, without
    writing anything -- this is the only enforcement `match_status` and the
    district-key nullability rule get, since neither is a CHECK constraint.

    Runtime-checks types rather than trusting MatchResult's annotations:
    dataclasses do not enforce them, and nothing downstream will catch a
    wrong type either.
    """
    errors: list[str] = []
    seen_ids: set[int] = set()

    for i, row in enumerate(rows):
        row_errors: list[str] = []

        if not isinstance(row.br_database_id, int) or isinstance(row.br_database_id, bool):
            row_errors.append(f"br_database_id must be an int, got {row.br_database_id!r}")
        elif row.br_database_id in seen_ids:
            # The results table is append-only with no key (module
            # docstring), so a duplicate inside one run makes "latest
            # attempt wins" ambiguous within that run's own rows.
            row_errors.append(f"br_database_id {row.br_database_id} is duplicated in this batch")
        else:
            seen_ids.add(row.br_database_id)

        district_fields = (row.l2_state, row.l2_district_type, row.l2_district_name)
        if row.match_status == MATCHED:
            if any(field is None for field in district_fields):
                row_errors.append("MATCHED row must have l2_state, l2_district_type and l2_district_name all non-null")
        elif row.match_status == ABSTAINED:
            if any(field is not None for field in district_fields):
                row_errors.append("ABSTAINED row must have l2_state, l2_district_type and l2_district_name all null")
        else:
            row_errors.append(f"match_status must be {MATCHED!r} or {ABSTAINED!r}, got {row.match_status!r}")

        if row.confidence is not None and (
            isinstance(row.confidence, bool) or not isinstance(row.confidence, int) or not 0 <= row.confidence <= 100
        ):
            row_errors.append(f"confidence must be null or an int in [0, 100], got {row.confidence!r}")

        if row.attempted_at is None:
            row_errors.append("attempted_at must be present")

        if row_errors:
            errors.append(f"row {i} (br_database_id={row.br_database_id!r}): " + "; ".join(row_errors))

    if errors:
        raise ValueError(f"{len(errors)} of {len(rows)} row(s) failed validation:\n" + "\n".join(errors))


def _chunked(rows: list[ResultRow], size: int) -> Iterator[list[ResultRow]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


class MatchRunWriter:
    """The run lifecycle: create, append, complete, revoke. Each method is
    one deliberate action a human triggers by hand during the supervised
    cutover (SPEC 3.4/3.5); nothing here decides FOR the operator whether a
    run should be completed or revoked.
    """

    def __init__(
        self,
        catalog: str = CATALOG,
        model_predictions_schema: str = MODEL_PREDICTIONS_SCHEMA,
        district_universe_schema: str = DISTRICT_UNIVERSE_SCHEMA,
        databricks: DatabricksClient | None = None,
    ) -> None:
        """`databricks` is injectable so the cutover can share the matcher's
        own session instead of opening a second one -- DatabricksClient
        memoizes its connection and never health-checks it, and the cutover
        is hand-driven across a long session with a human review pause in
        the middle. `close()` only closes a connection this instance opened
        itself (see `close`): closing a shared, injected one out from under
        its other owner would defeat the point of sharing it.
        """
        self.logger = get_logger(__name__)
        self._owns_databricks = databricks is None
        self.databricks = databricks or DatabricksClient()
        self._closed = False
        self.runs_table = f"{catalog}.{model_predictions_schema}.{RUNS_TABLE}"
        self.results_table = f"{catalog}.{model_predictions_schema}.{RESULTS_TABLE}"
        self.district_universe_table = f"{catalog}.{district_universe_schema}.{DISTRICT_UNIVERSE_TABLE}"

    def _check_not_closed(self) -> None:
        if self._closed:
            raise RuntimeError("This MatchRunWriter has been closed; construct a new one")

    def _cursor(self) -> Cursor:
        return self.databricks.connect().cursor()

    def _run_status(self, cursor: Cursor, run_id: str) -> str:
        cursor.execute(f"select status from {self.runs_table} where run_id = ?", [run_id])
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"No run with run_id={run_id!r}")
        status: str = row[0]
        return status

    # -- create -------------------------------------------------------------

    def create_run(self) -> str:
        """Insert one RUNNING row and return its run_id.

        Generated here, not by the database: `sequence` is the identity
        column that gives the run its order, but a result row needs its
        run_id before `sequence` can exist to assign it.
        """
        self._check_not_closed()
        run_id = str(uuid.uuid4())
        cursor = self._cursor()
        try:
            cursor.execute(
                f"insert into {self.runs_table} (run_id, status, started_at) values (?, ?, ?)",
                [run_id, RUNNING, datetime.now(UTC)],
            )
        finally:
            cursor.close()
        self.logger.info(f"Created run {run_id}")
        return run_id

    # -- append ---------------------------------------------------------------

    def append_results(self, run_id: str, results: list[MatchResult], attempted_at: datetime) -> int:
        """Validate the whole batch, then bulk-insert it under `run_id`.

        Single-shot per run: refuses to append when the run already has ANY
        result rows. The connector has no transactions -- `Connection.
        commit()` is a documented no-op and `rollback()` raises
        `NotSupportedError` -- so each chunk auto-commits independently. A
        retry after a partial failure (chunk 12 of 41 fails on a warehouse
        restart, say) would otherwise pass every other guard: the run is
        still RUNNING, and `validate_result_rows`' duplicate check only ever
        sees the rows in THIS call, never the ones already durable in the
        table, so a naive re-call double-writes. Revoking the run
        (`revoke_run`) and starting a fresh one is the fix -- not a MERGE,
        which is a bigger mechanism than the problem.

        Refuses to append to a run that is not RUNNING for a second reason:
        run status is what makes a result real (SPEC 3.4), so writing rows
        under an already-COMPLETE run would make them live without ever
        passing through the human review step that completing is supposed
        to gate.

        Multi-row INSERT with bound parameters throughout, chunked at
        RESULTS_INSERT_CHUNK_SIZE -- never Cursor.executemany, which issues
        one sequential request per row with no batching (its own docstring).
        """
        self._check_not_closed()
        if not results:
            self.logger.warning(f"append_results called with zero rows for run {run_id}; nothing to do")
            return 0

        cursor = self._cursor()
        try:
            status = self._run_status(cursor, run_id)
            if status != RUNNING:
                raise ValueError(f"Cannot append to run {run_id}: status is {status!r}, expected {RUNNING!r}")

            cursor.execute(f"select count(*) from {self.results_table} where run_id = ?", [run_id])
            (existing_count,) = cursor.fetchone()
            if existing_count:
                raise ValueError(
                    f"Run {run_id} already has {existing_count} result row(s); append_results is "
                    f"single-shot and refuses to add more (see this method's docstring). Revoke this "
                    f"run with MatchRunWriter.revoke_run and start a new one instead."
                )

            rows = _to_result_rows(run_id, results, attempted_at)
            validate_result_rows(rows)

            for chunk in _chunked(rows, RESULTS_INSERT_CHUNK_SIZE):
                placeholders = ", ".join(["(?, ?, ?, ?, ?, ?, ?, ?)"] * len(chunk))
                params = [
                    value
                    for row in chunk
                    for value in (
                        row.run_id,
                        row.br_database_id,
                        row.l2_state,
                        row.l2_district_type,
                        row.l2_district_name,
                        row.match_status,
                        row.confidence,
                        row.attempted_at,
                    )
                ]
                cursor.execute(
                    f"""
                    insert into {self.results_table}
                        (run_id, br_database_id, l2_state, l2_district_type, l2_district_name,
                         match_status, confidence, attempted_at)
                    values {placeholders}
                    """,
                    params,
                )
        finally:
            cursor.close()
        self.logger.info(f"Appended {len(results)} result row(s) to run {run_id}")
        return len(results)

    # -- set-level invariants (after the rows land, before COMPLETE) --------

    def check_set_level_invariants(self, run_id: str, expected_row_count: int) -> None:
        """Four aggregate checks that can only run once the rows exist
        (SPEC 3.5). Not enumerated in the SPEC text -- my own derivation;
        flagged in the PR report. Collects every failure rather than
        stopping at the first, so a human revoking the run gets the full
        picture in one pass.

        Public for a dry look, but `complete_run` also calls this itself
        before completing (see its docstring) -- calling it here first is
        not a substitute for that: an operator can simply forget the
        separate call, and an unchecked run publishing is a Tier-1 failure.

        Every query below filters the RESULTS table by run_id and none
        joins the runs table, so a mistyped or stale run_id would otherwise
        read as zero duplicates, zero bad statuses, zero orphans and a
        count of 0 -- reporting a clean pass for a run that does not exist.
        The explicit existence check below is what stops that.
        """
        cursor = self._cursor()
        try:
            self._run_status(cursor, run_id)  # raises "No run with run_id=..." if it does not exist
            failures = [
                message
                for message in (
                    self._check_row_count(cursor, run_id, expected_row_count),
                    self._check_no_duplicate_br_database_id(cursor, run_id),
                    self._check_match_status_values(cursor, run_id),
                    self._check_matched_rows_in_universe(cursor, run_id),
                )
                if message is not None
            ]
        finally:
            cursor.close()
        if failures:
            raise RuntimeError(f"Run {run_id} failed {len(failures)} set-level invariant(s):\n" + "\n".join(failures))

    def _check_row_count(self, cursor: Cursor, run_id: str, expected_row_count: int) -> str | None:
        """`expected_row_count` is the size of the one append this run will
        ever get: `append_results` refuses a second call against a run that
        already has rows, so "cumulative for this run" and "this batch" are
        the same number by construction, not two things that could drift.
        """
        cursor.execute(f"select count(*) from {self.results_table} where run_id = ?", [run_id])
        (actual,) = cursor.fetchone()
        if actual != expected_row_count:
            return f"row count is {actual}, expected {expected_row_count}"
        return None

    def _check_no_duplicate_br_database_id(self, cursor: Cursor, run_id: str) -> str | None:
        cursor.execute(
            f"""
            select count(*) from (
                select br_database_id from {self.results_table}
                where run_id = ?
                group by br_database_id
                having count(*) > 1
            )
            """,
            [run_id],
        )
        (duplicate_count,) = cursor.fetchone()
        if duplicate_count:
            return f"{duplicate_count} br_database_id(s) appear more than once"
        return None

    def _check_match_status_values(self, cursor: Cursor, run_id: str) -> str | None:
        cursor.execute(
            f"select count(*) from {self.results_table} where run_id = ? and match_status not in (?, ?)",
            [run_id, MATCHED, ABSTAINED],
        )
        (bad_count,) = cursor.fetchone()
        if bad_count:
            return f"{bad_count} row(s) carry a match_status outside {{MATCHED, ABSTAINED}}"
        return None

    def _check_matched_rows_in_universe(self, cursor: Cursor, run_id: str) -> str | None:
        """Normalizes `u.state_postal_code` on the join, not `r.l2_state`:
        `build_universe` rewrites the state column in memory with
        `_normalize_state` (strip + upper) before anything is embedded or
        matched, so every `l2_state` this module ever writes is already
        canonical. `state_postal_code` here is read fresh from the LIVE
        universe table, bypassing that in-memory step -- one lower-cased L2
        delivery would otherwise make every MATCHED row in that state
        compare unequal and read as an orphan, failing an otherwise-good run.
        """
        cursor.execute(
            f"""
            select count(*)
            from {self.results_table} r
            left join {self.district_universe_table} u
              on r.l2_state = upper(trim(u.state_postal_code))
             and r.l2_district_type = u.district_type
             and r.l2_district_name = u.district_name
            where r.run_id = ? and r.match_status = ? and u.state_postal_code is null
            """,
            [run_id, MATCHED],
        )
        (orphan_count,) = cursor.fetchone()
        if orphan_count:
            return f"{orphan_count} MATCHED row(s) reference a district outside the current universe"
        return None

    # -- complete / revoke ----------------------------------------------------

    def complete_run(self, run_id: str, expected_row_count: int, force: bool = False) -> None:
        """RUNNING -> COMPLETE, running `check_set_level_invariants` itself
        first (unless `force=True`).

        "Small and separately callable" operations mean an operator can
        complete a run without ever calling `check_set_level_invariants` --
        that is not enforcement, since a human can simply forget the
        separate step, and `int__l2_br_match_pending_offices` inner-joins on
        `status = 'COMPLETE'` with no further filter, so an unchecked run
        publishes immediately. `force=True` exists for a human knowingly
        overriding a benign, already-understood failure; it does not skip
        the RUNNING guard below.

        The transition is a conditional UPDATE (`... and status = ?`), not
        a read-then-blind-write: a plain re-check is not atomic against a
        concurrent `revoke_run` landing in the gap between the read and the
        write, which would otherwise let this UPDATE overwrite a deliberate
        rollback back to COMPLETE with `revoked_reason` still populated.
        Re-reads afterward to confirm the write actually took effect, since
        `Cursor.rowcount` on this connector is hard-coded to -1 and cannot
        report what the UPDATE touched -- `rowcount` being unpopulated stops
        it from REPORTING what changed, not from making the WHERE clause
        itself uphold the guard, which is what the added condition does.
        """
        self._check_not_closed()
        cursor = self._cursor()
        try:
            status = self._run_status(cursor, run_id)
            if status != RUNNING:
                raise ValueError(f"Cannot complete run {run_id}: status is {status!r}, expected {RUNNING!r}")
        finally:
            cursor.close()

        if not force:
            self.check_set_level_invariants(run_id, expected_row_count)

        cursor = self._cursor()
        try:
            cursor.execute(
                f"update {self.runs_table} set status = ?, completed_at = ? where run_id = ? and status = ?",
                [COMPLETE, datetime.now(UTC), run_id, RUNNING],
            )
            confirmed_status = self._run_status(cursor, run_id)
            if confirmed_status != COMPLETE:
                raise ValueError(
                    f"Cannot complete run {run_id}: status is {confirmed_status!r} after the update, "
                    f"expected {COMPLETE!r} -- a concurrent revoke likely landed between the guard "
                    f"and the write"
                )
        finally:
            cursor.close()
        self.logger.info(f"Completed run {run_id}")

    def revoke_run(self, run_id: str, reason: str) -> None:
        """REVOKED for `run_id` and every run sequenced after it (SPEC 3.4):
        rollback restores whatever was true before a LATER run's mistakes
        landed, not just before this one's -- revoking only the target run
        would leave a later, also-bad run COMPLETE and still being read.
        Unconditional on the current status of each affected run, by
        design: a COMPLETE run must be revocable at all, which is the whole
        point of rollback, so this is not narrowed to `... and status = ?`
        the way `complete_run`'s transition now is.

        `coalesce(revoked_reason, ?)` sets the reason only where it is
        currently null, so re-running the cascade over an already-revoked
        run (a normal side effect of revoking an earlier one) does not
        clobber that run's own, possibly more specific, recorded reason --
        the column's own DDL comment says it exists so a REVOKED run is not
        an operational dead end, and overwriting an earlier note defeats
        that in the same method that requires a reason at all.
        """
        self._check_not_closed()
        if not reason or not reason.strip():
            raise ValueError("revoke_run requires a non-blank reason")
        cursor = self._cursor()
        try:
            cursor.execute(f"select sequence from {self.runs_table} where run_id = ?", [run_id])
            row = cursor.fetchone()
            if row is None:
                raise ValueError(f"No run with run_id={run_id!r}")
            (target_sequence,) = row
            cursor.execute(
                f"update {self.runs_table} set status = ?, revoked_reason = coalesce(revoked_reason, ?) "
                f"where sequence >= ?",
                [REVOKED, reason, target_sequence],
            )
            confirmed_status = self._run_status(cursor, run_id)
            if confirmed_status != REVOKED:
                raise RuntimeError(
                    f"Run {run_id} read back as {confirmed_status!r}, not {REVOKED!r}, immediately "
                    f"after revoking it -- the write may not have landed"
                )
        finally:
            cursor.close()
        self.logger.info(f"Revoked run {run_id} and every run sequenced at or after {target_sequence}: {reason}")

    # -- resource lifecycle ---------------------------------------------------

    def close(self) -> None:
        """Close the Databricks connection this instance opened itself.

        A no-op if `databricks` was injected at construction (see
        `__init__`) -- closing a session another owner is still using would
        defeat the point of sharing it -- and a no-op if already closed.
        """
        if self._closed:
            return
        self._closed = True
        if self._owns_databricks:
            self.databricks.close()

    def __enter__(self) -> "MatchRunWriter":
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: object) -> None:
        try:
            self.close()
        except Exception:
            self.logger.exception("Error while closing MatchRunWriter; any original exception takes priority")
