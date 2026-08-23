"""Databricks write path and run lifecycle for the L2-to-BallotReady matcher.

Four small, separately-callable operations over the two tables T1 created
outside dbt (dbt/scripts/llm_l2_br_match_tables.sql) and reads only as
sources: create a run, append its results, complete it, or revoke it plus
every run sequenced after it. The supervised cutover drives these by hand --
a human reviews the rows a run just wrote before deciding to complete it
(SPEC 3.4 step 3), so no function here chains straight from append to
complete on its own.

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
# tuned against a live warehouse -- the cutover run is what measures it.
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
    ) -> None:
        self.logger = get_logger(__name__)
        self.databricks = DatabricksClient()
        self.runs_table = f"{catalog}.{model_predictions_schema}.{RUNS_TABLE}"
        self.results_table = f"{catalog}.{model_predictions_schema}.{RESULTS_TABLE}"
        self.district_universe_table = f"{catalog}.{district_universe_schema}.{DISTRICT_UNIVERSE_TABLE}"

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

        Refuses to append to a run that is not RUNNING: run status is what
        makes a result real (SPEC 3.4), so writing more rows under an
        already-COMPLETE run would make them live without ever passing
        through the human review step that completing is supposed to gate.

        Multi-row INSERT with bound parameters throughout, chunked at
        RESULTS_INSERT_CHUNK_SIZE -- never Cursor.executemany, which issues
        one sequential request per row with no batching (its own docstring).
        """
        if not results:
            self.logger.warning(f"append_results called with zero rows for run {run_id}; nothing to do")
            return 0

        cursor = self._cursor()
        try:
            status = self._run_status(cursor, run_id)
            if status != RUNNING:
                raise ValueError(f"Cannot append to run {run_id}: status is {status!r}, expected {RUNNING!r}")

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
        """
        cursor = self._cursor()
        try:
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
        cursor.execute(
            f"""
            select count(*)
            from {self.results_table} r
            left join {self.district_universe_table} u
              on r.l2_state = u.state_postal_code
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

    def complete_run(self, run_id: str) -> None:
        """RUNNING -> COMPLETE. Guarded on the current status so completing
        twice, or completing a run that was revoked in between, cannot
        silently succeed. The guard has to be a read-before-write check:
        `Cursor.rowcount` on this connector is hard-coded to -1 (not
        populated), so an UPDATE cannot report how many rows it touched.
        """
        cursor = self._cursor()
        try:
            status = self._run_status(cursor, run_id)
            if status != RUNNING:
                raise ValueError(f"Cannot complete run {run_id}: status is {status!r}, expected {RUNNING!r}")
            cursor.execute(
                f"update {self.runs_table} set status = ?, completed_at = ? where run_id = ?",
                [COMPLETE, datetime.now(UTC), run_id],
            )
        finally:
            cursor.close()
        self.logger.info(f"Completed run {run_id}")

    def revoke_run(self, run_id: str, reason: str) -> None:
        """REVOKED for `run_id` and every run sequenced after it (SPEC 3.4):
        rollback restores whatever was true before a LATER run's mistakes
        landed, not just before this one's -- revoking only the target run
        would leave a later, also-bad run COMPLETE and still being read.
        """
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
                f"update {self.runs_table} set status = ?, revoked_reason = ? where sequence >= ?",
                [REVOKED, reason, target_sequence],
            )
        finally:
            cursor.close()
        self.logger.info(f"Revoked run {run_id} and every run sequenced at or after {target_sequence}: {reason}")
