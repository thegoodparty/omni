from datetime import UTC, datetime
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest

from stitch_golden_data.prod_gold_data.l2_br_match_writer import (
    COMPLETE,
    RESULTS_INSERT_CHUNK_SIZE,
    REVOKED,
    RUNNING,
    MatchRunWriter,
    ResultRow,
    validate_result_rows,
)
from stitch_golden_data.prod_gold_data.l2_br_matcher import ABSTAINED, MATCHED, MatchResult

ATTEMPTED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _row(
    br_database_id: int = 1,
    l2_state: str | None = "DE",
    l2_district_type: str | None = "House",
    l2_district_name: str | None = "District 5",
    match_status: str = MATCHED,
    confidence: int | None = 90,
) -> ResultRow:
    return ResultRow(
        run_id="run-1",
        br_database_id=br_database_id,
        l2_state=l2_state,
        l2_district_type=l2_district_type,
        l2_district_name=l2_district_name,
        match_status=match_status,
        confidence=confidence,
        attempted_at=ATTEMPTED_AT,
    )


class TestResultRowValidation:
    """Per-row validation is the ONLY enforcement `match_status` and the
    district-key nullability rule get -- neither is a Delta CHECK
    constraint (ledger decision). SPEC 3.5 puts the guard here.
    """

    def test_a_valid_batch_passes(self):
        """Failure this catches: a validator that rejects legitimate output,
        including the zero-candidate ABSTAIN path's null confidence.
        """
        rows = [
            _row(br_database_id=1, match_status=MATCHED, confidence=90),
            _row(
                br_database_id=2,
                l2_state=None,
                l2_district_type=None,
                l2_district_name=None,
                match_status=ABSTAINED,
                confidence=None,
            ),
        ]
        validate_result_rows(rows)  # must not raise

    @pytest.mark.parametrize(
        "bad_row,expected_substring",
        [
            (_row(match_status="NOT_MATCHED"), "match_status"),
            (_row(match_status=MATCHED, l2_state=None), "MATCHED row must have"),
            (_row(match_status=ABSTAINED, l2_state="DE"), "ABSTAINED row must have"),
            (_row(br_database_id="1"), "br_database_id must be an int"),
            (_row(br_database_id=True), "br_database_id must be an int"),
            (_row(confidence=101), "confidence must be null"),
            (_row(confidence=-1), "confidence must be null"),
            (_row(confidence=95.5), "confidence must be null"),
        ],
        ids=[
            "match-status-not-matched-or-abstained",
            "matched-with-null-district-field",
            "abstained-with-non-null-district-field",
            "br-database-id-not-an-int",
            "br-database-id-is-a-bool",
            "confidence-above-100",
            "confidence-below-0",
            "confidence-not-integral",
        ],
    )
    def test_each_invalid_field_is_rejected(self, bad_row, expected_substring):
        """Failure this catches: the row-level checks SPEC 3.5 requires
        (match_status domain, MATCHED/ABSTAINED nullability, br_database_id
        type, confidence range) silently accept garbage because nothing
        downstream -- no CHECK constraint exists -- would ever catch it.
        """
        with pytest.raises(ValueError, match=expected_substring):
            validate_result_rows([bad_row])

    def test_duplicate_br_database_id_across_the_batch_is_rejected(self):
        """Failure this catches: two rows for the same office in one run
        make "latest attempt wins" ambiguous within that run's own rows,
        since the results table is append-only with no key.
        """
        with pytest.raises(ValueError, match="duplicated"):
            validate_result_rows([_row(br_database_id=1), _row(br_database_id=1)])

    def test_missing_attempted_at_is_rejected(self):
        """Failure this catches: a row with no attempted_at breaks the
        30-day pending clock the whole rule 2 of int__l2_br_match_pending_offices
        depends on.
        """
        row = _row()
        row.attempted_at = None
        with pytest.raises(ValueError, match="attempted_at must be present"):
            validate_result_rows([row])

    def test_multiple_bad_rows_are_all_reported_in_one_exception(self):
        """Failure this catches: only the first bad row is reported, so an
        operator fixes one problem, re-runs, and discovers the next one
        instead of seeing the whole picture up front.
        """
        with pytest.raises(ValueError) as exc_info:
            validate_result_rows(
                [
                    _row(br_database_id=1, match_status="GARBAGE"),
                    _row(br_database_id=2, confidence=999),
                ]
            )
        message = str(exc_info.value)
        assert "row 0" in message
        assert "row 1" in message


@pytest.fixture
def mock_databricks():
    with patch("stitch_golden_data.prod_gold_data.l2_br_match_writer.DatabricksClient") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_cursor = MagicMock()
        mock_client.connect.return_value.cursor.return_value = mock_cursor
        yield {"client": mock_client, "cursor": mock_cursor}


def _insert_calls(cursor: MagicMock) -> list:
    return [c for c in cursor.execute.call_args_list if "insert into" in c.args[0].lower()]


def _update_calls(cursor: MagicMock) -> list:
    return [c for c in cursor.execute.call_args_list if "update" in c.args[0].lower()]


class TestCreateRun:
    def test_create_run_inserts_running_without_writing_sequence_and_returns_the_id(self, mock_databricks):
        """Failure this catches: an explicit `sequence` value, which Delta
        refuses outright for a `generated always as identity` column
        (DELTA_IDENTITY_COLUMNS_EXPLICIT_INSERT_NOT_SUPPORTED); or a
        returned run_id the caller cannot correlate with the inserted row.
        """
        writer = MatchRunWriter()

        run_id = writer.create_run()

        UUID(run_id)  # raises ValueError if this is not a real UUID
        insert_calls = _insert_calls(mock_databricks["cursor"])
        assert len(insert_calls) == 1
        query, params = insert_calls[0].args
        assert "sequence" not in query.lower()
        assert run_id in params
        assert RUNNING in params


class TestAppendResults:
    """append_results is single-shot per run (fix-round 1.3): the connector
    has no transactions, so a retry after a partial failure would otherwise
    pass every other guard and double-write. `fetchone.side_effect` below is
    always [status-check, existing-row-count] in that order.
    """

    def test_never_uses_executemany(self, mock_databricks):
        """Failure this catches: Cursor.executemany issues one sequential
        request per row with no batching (its own docstring) -- 20,166
        round trips for the backlog instead of dozens.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (0,)]
        writer = MatchRunWriter()

        writer.append_results("run-1", [MatchResult(1, "DE", "House", "District 5", MATCHED, 90)], ATTEMPTED_AT)

        mock_databricks["cursor"].executemany.assert_not_called()

    def test_binds_values_instead_of_interpolating_them(self, mock_databricks):
        """Failure this catches: an apostrophe in a district name breaks or
        silently rewrites an f-string-interpolated query instead of failing
        loudly -- PR 1 spent two review rounds on exactly this bug class.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (0,)]
        writer = MatchRunWriter()

        writer.append_results("run-1", [MatchResult(1, "DE", "House", "O'Brien District", MATCHED, 90)], ATTEMPTED_AT)

        insert_calls = _insert_calls(mock_databricks["cursor"])
        query, params = insert_calls[0].args
        assert "O'Brien" not in query
        assert "O'Brien District" in params

    def test_never_writes_sequence(self, mock_databricks):
        """Failure this catches: an explicit `sequence` value in the results
        INSERT, which does not carry the identity column but could still be
        hand-typed into the column list by mistake.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (0,)]
        writer = MatchRunWriter()

        writer.append_results("run-1", [MatchResult(1, "DE", "House", "District 5", MATCHED, 90)], ATTEMPTED_AT)

        insert_calls = _insert_calls(mock_databricks["cursor"])
        assert "sequence" not in insert_calls[0].args[0].lower()

    def test_chunks_at_the_module_constant(self, mock_databricks):
        """Failure this catches: one giant unchunked INSERT for the full
        20,166-office backlog instead of the bounded, documented chunk size.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (0,)]
        n = 2 * RESULTS_INSERT_CHUNK_SIZE + 1
        results = [MatchResult(i, "DE", "House", f"District {i}", MATCHED, 90) for i in range(n)]
        writer = MatchRunWriter()

        count = writer.append_results("run-1", results, ATTEMPTED_AT)

        assert count == n
        insert_calls = _insert_calls(mock_databricks["cursor"])
        assert len(insert_calls) == 3, f"expected 3 chunks for {n} rows, got {len(insert_calls)}"
        rows_per_call = [len(call.args[1]) // 8 for call in insert_calls]
        assert rows_per_call == [RESULTS_INSERT_CHUNK_SIZE, RESULTS_INSERT_CHUNK_SIZE, 1]

    @pytest.mark.parametrize("current_status", [COMPLETE, REVOKED])
    def test_refuses_when_the_run_is_not_running(self, mock_databricks, current_status):
        """Failure this catches: rows land under an already-COMPLETE or
        REVOKED run and become live without ever passing the human review
        step that completing is supposed to gate (SPEC 3.4 step 3).
        """
        mock_databricks["cursor"].fetchone.return_value = (current_status,)
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match=current_status):
            writer.append_results("run-1", [MatchResult(1, "DE", "House", "D5", MATCHED, 90)], ATTEMPTED_AT)

        assert _insert_calls(mock_databricks["cursor"]) == []

    def test_refuses_when_the_run_already_has_rows(self, mock_databricks):
        """Failure this catches (fix-round 1.3): the connector auto-commits
        each chunk with no transaction, so re-calling append_results after a
        partial failure (chunk 12 of 41 fails on a warehouse restart, say)
        would otherwise pass every other guard -- the run is still RUNNING,
        and validate_result_rows' duplicate check only ever sees THIS call's
        rows -- and double-write 5,500 rows already durable in the table.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (5,)]
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="already has 5"):
            writer.append_results("run-1", [MatchResult(1, "DE", "House", "D5", MATCHED, 90)], ATTEMPTED_AT)

        assert _insert_calls(mock_databricks["cursor"]) == []

    def test_validates_before_writing_anything(self, mock_databricks):
        """Failure this catches: a batch with one bad row gets partially
        written before validation notices, leaving a half-appended run.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (0,)]
        writer = MatchRunWriter()

        with pytest.raises(ValueError):
            writer.append_results("run-1", [MatchResult(1, "DE", "House", "D5", "NOT_A_STATUS", 90)], ATTEMPTED_AT)

        assert _insert_calls(mock_databricks["cursor"]) == []

    def test_empty_batch_writes_nothing_and_returns_zero(self, mock_databricks):
        """Failure this catches: an empty VALUES clause is invalid SQL --
        `insert into t values` with zero row groups -- so an empty batch
        must short-circuit rather than reach the INSERT.
        """
        writer = MatchRunWriter()

        count = writer.append_results("run-1", [], ATTEMPTED_AT)

        assert count == 0
        mock_databricks["cursor"].execute.assert_not_called()


class TestCompleteRun:
    """complete_run(run_id, expected_row_count, force=False) now runs
    check_set_level_invariants itself (fix-round 1.1) and its transition is
    a conditional UPDATE re-read to confirm (fix-round 1.2).
    """

    def test_transitions_running_to_complete_and_stamps_completed_at(self, mock_databricks):
        """Failure this catches: completing a run never actually flips its
        status, so int__l2_br_match_pending_offices (which inner-joins on
        status = 'COMPLETE') never sees it. force=True isolates the
        transition mechanics from the separately-tested invariant wiring.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (COMPLETE,)]
        writer = MatchRunWriter()

        writer.complete_run("run-1", expected_row_count=3, force=True)

        update_calls = _update_calls(mock_databricks["cursor"])
        assert len(update_calls) == 1
        query, params = update_calls[0].args
        assert "status = ?" in query.lower().replace("  ", " ")
        assert COMPLETE in params
        assert RUNNING in params  # the CAS condition, not just the new value
        assert "run-1" in params

    @pytest.mark.parametrize("current_status", [COMPLETE, REVOKED])
    def test_refuses_a_run_that_is_not_running(self, mock_databricks, current_status):
        """Failure this catches: completing twice, or completing a run that
        was revoked in between, silently succeeds.
        """
        mock_databricks["cursor"].fetchone.return_value = (current_status,)
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match=current_status):
            writer.complete_run("run-1", expected_row_count=3)

        assert _update_calls(mock_databricks["cursor"]) == []

    def test_raises_for_an_unknown_run_id(self, mock_databricks):
        """Failure this catches: completing a typo'd or nonexistent run_id
        silently no-ops instead of telling the operator nothing happened.
        """
        mock_databricks["cursor"].fetchone.return_value = None
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="No run with run_id"):
            writer.complete_run("does-not-exist", expected_row_count=0)

    def test_calls_check_set_level_invariants_before_completing(self, mock_databricks):
        """Failure this catches (fix-round 1.1): "small and separately
        callable" let an operator complete a run whose invariants were
        never checked -- a run with duplicates, a wrong row count, or an
        out-of-universe district becomes the live match set for its
        offices, and nothing reds.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (COMPLETE,)]
        writer = MatchRunWriter()
        with patch.object(writer, "check_set_level_invariants") as mock_check:
            writer.complete_run("run-1", expected_row_count=7)

        mock_check.assert_called_once_with("run-1", 7)

    def test_force_true_skips_the_invariant_check(self, mock_databricks):
        """Failure this catches: force is documented as an escape hatch for
        a human knowingly overriding a benign failure, but if it also skips
        the RUNNING guard or silently double-runs the check, it stops being
        a deliberate, narrow override.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (COMPLETE,)]
        writer = MatchRunWriter()
        with patch.object(writer, "check_set_level_invariants") as mock_check:
            writer.complete_run("run-1", expected_row_count=7, force=True)

        mock_check.assert_not_called()

    def test_a_failing_invariant_check_prevents_completion(self, mock_databricks):
        """Failure this catches: an invariant failure is logged but
        complete_run finishes the UPDATE anyway.
        """
        mock_databricks["cursor"].fetchone.return_value = (RUNNING,)
        writer = MatchRunWriter()
        with patch.object(writer, "check_set_level_invariants", side_effect=RuntimeError("bad run")):
            with pytest.raises(RuntimeError, match="bad run"):
                writer.complete_run("run-1", expected_row_count=7)

        assert _update_calls(mock_databricks["cursor"]) == []

    def test_concurrent_revoke_between_guard_and_write_is_caught(self, mock_databricks):
        """Failure this catches (fix-round 1.2): the pre-check reads
        RUNNING, a cascade revoke_run commits in the gap, and an
        unconditional UPDATE matching on run_id alone overwrites the
        rollback back to COMPLETE with revoked_reason still populated --
        the run the operator deliberately rolled back would go live again.
        force=True isolates this from the (separately tested) invariant call.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (REVOKED,)]
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="concurrent revoke"):
            writer.complete_run("run-1", expected_row_count=3, force=True)


class TestRevokeRun:
    def _seed(self, mock_databricks, sequence: int, final_status: str = REVOKED):
        mock_databricks["cursor"].fetchone.side_effect = [(sequence,), (final_status,)]

    @pytest.mark.parametrize("reason", ["", "   "])
    def test_requires_a_non_blank_reason(self, mock_databricks, reason):
        """Failure this catches: a REVOKED run with no recorded reason is an
        operational dead end days later (the column's own DDL comment).
        """
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="reason"):
            writer.revoke_run("run-1", reason)

        mock_databricks["cursor"].execute.assert_not_called()

    def test_cascades_to_every_run_sequenced_at_or_after_the_target(self, mock_databricks):
        """Failure this catches: revoking only the target run leaves a
        later, also-bad run COMPLETE and still being read, so rollback does
        not actually restore what was true before that later run landed
        (SPEC 3.4).
        """
        self._seed(mock_databricks, sequence=5)
        writer = MatchRunWriter()

        writer.revoke_run("run-1", "bad geography filter")

        update_calls = _update_calls(mock_databricks["cursor"])
        assert len(update_calls) == 1
        query, params = update_calls[0].args
        assert ">=" in query
        assert 5 in params
        assert REVOKED in params
        assert "bad geography filter" in params

    def test_preserves_an_already_recorded_reason(self, mock_databricks):
        """Failure this catches (fix-round 2.1): the cascade is by design
        (SPEC 3.4), but rewriting an existing revoked_reason on every later
        revoke destroys the audit note the column's own DDL comment says it
        exists for -- in the same method that requires a reason at all.
        Asserted at the query-text level: a mocked cursor cannot execute
        SQL's own COALESCE, so the guarantee lives in the statement shape.
        """
        self._seed(mock_databricks, sequence=5)
        writer = MatchRunWriter()

        writer.revoke_run("run-1", "second rollback")

        query, _ = _update_calls(mock_databricks["cursor"])[0].args
        assert "coalesce(revoked_reason" in query.lower()

    def test_raises_for_an_unknown_run_id(self, mock_databricks):
        """Failure this catches: revoking a typo'd run_id silently updates
        zero rows instead of telling the operator nothing happened.
        """
        mock_databricks["cursor"].fetchone.return_value = None
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="No run with run_id"):
            writer.revoke_run("does-not-exist", "cleanup")

        assert _update_calls(mock_databricks["cursor"]) == []

    def test_raises_if_the_run_does_not_read_back_as_revoked(self, mock_databricks):
        """Failure this catches: the UPDATE silently fails to land (e.g. a
        stale sequence, a warehouse hiccup) and revoke_run reports success
        anyway, leaving the operator to believe a rollback happened when it
        did not.
        """
        self._seed(mock_databricks, sequence=5, final_status=RUNNING)
        writer = MatchRunWriter()

        with pytest.raises(RuntimeError, match="read back as"):
            writer.revoke_run("run-1", "bad geography filter")


class TestSetLevelInvariants:
    """SPEC 3.5: these run after the rows land and before COMPLETE, because
    they cannot be evaluated until the rows exist. `fetchone.side_effect`
    below is always [existence-check, row-count, duplicate, match_status,
    universe] in that order (fix-round 1.4 added the existence check).
    """

    def test_a_passing_run_raises_nothing(self, mock_databricks):
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (3,), (0,), (0,), (0,)]
        writer = MatchRunWriter()

        writer.check_set_level_invariants("run-1", expected_row_count=3)  # must not raise

    def test_raises_for_an_unknown_run_id(self, mock_databricks):
        """Failure this catches (fix-round 1.4): all four queries filter
        the RESULTS table by run_id and none joins the runs table, so a
        mistyped or stale id reads as 0 duplicates, 0 bad statuses, 0
        orphans and a count of 0 -- the verification step of a supervised
        cutover reporting a clean pass for a run that does not exist.
        """
        mock_databricks["cursor"].fetchone.return_value = None
        writer = MatchRunWriter()

        with pytest.raises(ValueError, match="No run with run_id"):
            writer.check_set_level_invariants("does-not-exist", expected_row_count=0)

    @pytest.mark.parametrize(
        "fetch_results,expected_substring",
        [
            ([(RUNNING,), (2,), (0,), (0,), (0,)], "row count"),
            ([(RUNNING,), (3,), (1,), (0,), (0,)], "appear more than once"),
            ([(RUNNING,), (3,), (0,), (2,), (0,)], "match_status outside"),
            ([(RUNNING,), (3,), (0,), (0,), (4,)], "outside the current universe"),
        ],
        ids=["row-count-mismatch", "duplicate-br-database-id", "bad-match-status", "matched-row-outside-universe"],
    )
    def test_each_invariant_names_its_own_failure(self, mock_databricks, fetch_results, expected_substring):
        """Failure this catches: a completed run keeps a duplicate key, a
        garbage status, a wrong row count, or a district the universe no
        longer carries, and every following run repeats it (SPEC 3.5).
        """
        mock_databricks["cursor"].fetchone.side_effect = fetch_results
        writer = MatchRunWriter()

        with pytest.raises(RuntimeError, match=expected_substring):
            writer.check_set_level_invariants("run-1", expected_row_count=3)

    def test_multiple_failing_invariants_are_all_reported_together(self, mock_databricks):
        """Failure this catches: only the first failing check is surfaced,
        so a human revoking the run records an incomplete reason and
        discovers the second real problem only after a second failed pass.
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (2,), (1,), (0,), (0,)]
        writer = MatchRunWriter()

        with pytest.raises(RuntimeError) as exc_info:
            writer.check_set_level_invariants("run-1", expected_row_count=3)

        message = str(exc_info.value)
        assert "row count" in message
        assert "appear more than once" in message

    def test_matched_rows_in_universe_check_normalizes_the_universe_side(self, mock_databricks):
        """Failure this catches (fix-round 1.5): build_universe normalizes
        l2_state in memory before anything is written, but this query reads
        state_postal_code fresh from the LIVE universe table, bypassing
        that step -- one lower-cased L2 delivery would make every MATCHED
        row in that state compare unequal and read as an orphan, failing an
        otherwise-good run. Asserted at the query-text level since a mocked
        cursor cannot execute SQL's own upper()/trim().
        """
        mock_databricks["cursor"].fetchone.side_effect = [(RUNNING,), (3,), (0,), (0,), (0,)]
        writer = MatchRunWriter()

        writer.check_set_level_invariants("run-1", expected_row_count=3)

        universe_call = [
            c for c in mock_databricks["cursor"].execute.call_args_list if "district_universe" in c.args[0]
        ]
        assert len(universe_call) == 1
        query = universe_call[0].args[0]
        assert "upper(trim(u.state_postal_code))" in query.lower()


class TestClosedWriterRefusesNewWork:
    """Mirrors L2BrMatcher's own _closed guard (fix-round 2.2's reasoning,
    applied here for the same DatabricksClient.connect()-silently-reopens
    trap): a writer method after close() should fail clearly, not read a
    freshly-reopened connection behind the caller's back.
    """

    def test_create_run_refuses_after_close(self, mock_databricks):
        writer = MatchRunWriter()
        writer.close()

        with pytest.raises(RuntimeError, match="closed"):
            writer.create_run()


class TestResourceLifecycle:
    """fix-round 2.3: MatchRunWriter had no close() / context manager at
    all, in the same diff that added exactly those to L2BrMatcher for
    exactly this reason.
    """

    def test_close_closes_a_self_opened_connection(self, mock_databricks):
        """Failure this catches: DatabricksClient.close() exists but
        nothing calls it, leaking the connection for the life of the
        process.
        """
        writer = MatchRunWriter()

        writer.close()

        mock_databricks["client"].close.assert_called_once()

    def test_close_does_not_close_an_injected_connection(self):
        """Failure this catches (fix-round 2.3): DatabricksClient is
        injectable so the cutover can share the matcher's own session --
        closing it out from under that other owner on this instance's
        close() would defeat the entire point of sharing it.
        """
        injected = MagicMock()
        writer = MatchRunWriter(databricks=injected)

        writer.close()

        injected.close.assert_not_called()

    def test_context_manager_exit_calls_close(self, mock_databricks):
        with MatchRunWriter() as writer:
            pass

        mock_databricks["client"].close.assert_called_once()
        with pytest.raises(RuntimeError, match="closed"):
            writer.create_run()

    def test_close_is_idempotent(self, mock_databricks):
        """Failure this catches: a second close() (e.g. from __exit__ after
        an explicit close()) re-invokes DatabricksClient.close() or raises,
        instead of being a clean no-op.
        """
        writer = MatchRunWriter()
        writer.close()

        writer.close()

        mock_databricks["client"].close.assert_called_once()
