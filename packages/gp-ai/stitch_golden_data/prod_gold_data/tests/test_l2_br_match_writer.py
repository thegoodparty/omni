from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from stitch_golden_data.prod_gold_data.l2_br_match_writer import (
    RESULTS_INSERT_CHUNK_SIZE,
    MatchResultWriter,
    validate_results,
)
from stitch_golden_data.prod_gold_data.l2_br_matcher import MatchResult

ATTEMPTED_AT = datetime(2026, 1, 1, tzinfo=UTC)
RESULTS_COLUMN_COUNT = 6


def _match(br_database_id: int = 1, name: str | None = "District 5") -> MatchResult:
    return MatchResult(br_database_id, "DE", "House", name, 90)


def _abstention(br_database_id: int = 1) -> MatchResult:
    return MatchResult(br_database_id, None, None, None, 15)


class TestResultValidation:
    """Two rules, and they are the only enforcement either one gets: neither
    is a Delta CHECK constraint (ledger decision -- per-row validation
    belongs in the container) and neither is a dbt test.
    """

    def test_a_batch_of_matches_and_abstentions_passes(self):
        """Failure this catches: a validator strict enough to reject a
        legitimate all-null abstention, which would block every office the
        model declines to match -- roughly 12,000 of them on the seeded
        baseline.
        """
        validate_results([_match(1), _abstention(2), _match(3)])

    @pytest.mark.parametrize(
        "partial",
        [
            MatchResult(1, "DE", "House", None, 90),
            MatchResult(1, "DE", None, "District 5", 90),
            MatchResult(1, None, "House", "District 5", 90),
            MatchResult(1, "DE", None, None, 90),
        ],
    )
    def test_a_partial_district_key_is_rejected(self, partial):
        """Failure this catches: a row that is neither a match nor an
        abstention. It fails quietly rather than loudly -- a partial key
        misses the universe join, so the office reopens on every pending-list
        build and re-pays the LLM cost indefinitely.
        """
        with pytest.raises(ValueError, match="all set"):
            validate_results([partial])

    def test_a_duplicate_br_database_id_inside_one_batch_is_rejected(self):
        """Failure this catches: two rows for one office under one run key.
        The anti-join in append_results only sees rows already durable in the
        table, so a batch that a sharded or concatenated run built carries
        this past it, and "latest attempt wins" has no answer for two rows at
        one timestamp.
        """
        with pytest.raises(ValueError, match="duplicated"):
            validate_results([_match(1), _match(1, name="District 6")])


@pytest.fixture
def mock_databricks():
    with patch("stitch_golden_data.prod_gold_data.l2_br_match_writer.DatabricksClient") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_cursor = MagicMock()
        mock_client.connect.return_value.cursor.return_value = mock_cursor
        # The two reads append_results makes, in order: the anti-join's
        # already-written ids, then the post-insert row count.
        mock_cursor.fetchall.return_value = []
        yield {"client": mock_client, "cursor": mock_cursor}


def _calls(cursor: MagicMock, fragment: str) -> list:
    return [c for c in cursor.execute.call_args_list if fragment in c.args[0].lower()]


class TestAppendResults:
    def test_binds_values_instead_of_interpolating_them(self, mock_databricks):
        """Failure this catches: an apostrophe in a district name breaks or
        silently rewrites an f-string-interpolated query instead of failing
        loudly. Real district names carry them.
        """
        mock_databricks["cursor"].fetchone.return_value = (1,)
        writer = MatchResultWriter()

        writer.append_results([_match(1, name="O'Brien District")], ATTEMPTED_AT)

        query, params = _calls(mock_databricks["cursor"], "insert into")[0].args
        assert "O'Brien" not in query
        assert "O'Brien District" in params

    def test_chunks_at_the_module_constant(self, mock_databricks):
        """Failure this catches: one unchunked INSERT for the whole 20,166
        office backlog, which blows past the bound-parameter count verified
        against this connector.
        """
        n = 2 * RESULTS_INSERT_CHUNK_SIZE + 1
        mock_databricks["cursor"].fetchone.return_value = (n,)
        results = [_match(i, name=f"District {i}") for i in range(n)]
        writer = MatchResultWriter()

        written = writer.append_results(results, ATTEMPTED_AT)

        assert written == n
        insert_calls = _calls(mock_databricks["cursor"], "insert into")
        assert len(insert_calls) == 3, f"expected 3 chunks for {n} rows, got {len(insert_calls)}"
        rows_per_call = [len(c.args[1]) // RESULTS_COLUMN_COUNT for c in insert_calls]
        assert rows_per_call == [RESULTS_INSERT_CHUNK_SIZE, RESULTS_INSERT_CHUNK_SIZE, 1]

    def test_skips_offices_already_written_under_this_run_key(self, mock_databricks):
        """Failure this catches: a resumed run writing a second row for an
        office it already wrote. The matcher is not deterministic, so those
        two rows are two different answers at one timestamp with no rule for
        choosing between them.
        """
        mock_databricks["cursor"].fetchall.return_value = [(1,), (2,)]
        mock_databricks["cursor"].fetchone.return_value = (3,)
        writer = MatchResultWriter()

        written = writer.append_results([_match(1), _match(2), _match(3)], ATTEMPTED_AT)

        assert written == 1
        params = _calls(mock_databricks["cursor"], "insert into")[0].args[1]
        assert 3 in params
        assert 1 not in params and 2 not in params

    def test_a_short_write_raises_and_names_the_recovery(self, mock_databricks):
        """Failure this catches: a run that lost rows part-way through
        reporting success. The connector has no transactions, so each chunk
        commits on its own; counting what landed is the only thing standing
        between an incomplete run and a published one.
        """
        mock_databricks["cursor"].fetchone.return_value = (1,)
        writer = MatchResultWriter()

        with pytest.raises(RuntimeError, match="Short write"):
            writer.append_results([_match(1), _match(2), _match(3)], ATTEMPTED_AT)

    def test_validates_the_whole_batch_before_writing_anything(self, mock_databricks):
        """Failure this catches: validation moved inside the chunk loop, so a
        bad row in chunk 12 leaves chunks 1-11 durable -- turning a rejected
        batch into a partial run that needs a rollback.
        """
        mock_databricks["cursor"].fetchone.return_value = (0,)
        results = [_match(i) for i in range(RESULTS_INSERT_CHUNK_SIZE + 1)]
        results[-1] = MatchResult(9999, "DE", "House", None, 90)
        writer = MatchResultWriter()

        with pytest.raises(ValueError, match="all set"):
            writer.append_results(results, ATTEMPTED_AT)

        assert _calls(mock_databricks["cursor"], "insert into") == []


class TestDeleteRun:
    def test_deletes_on_the_run_key_with_a_bound_parameter(self, mock_databricks):
        """Failure this catches: a rollback that deletes the wrong rows.
        This is the repair for both a bad run and a short write, so its blast
        radius is the whole run either way.
        """
        writer = MatchResultWriter()

        writer.delete_run(ATTEMPTED_AT)

        query, params = _calls(mock_databricks["cursor"], "delete from")[0].args
        assert "attempted_at = ?" in query
        assert params == [ATTEMPTED_AT]


class TestResourceLifecycle:
    def test_close_does_not_close_an_injected_connection(self):
        """Failure this catches: the writer closing the session the matcher
        is still using. The cutover shares one connection across a long
        hand-driven run with a human review pause in the middle.
        """
        injected = MagicMock()
        writer = MatchResultWriter(databricks=injected)

        writer.close()

        injected.close.assert_not_called()

    def test_close_closes_a_connection_it_opened_itself(self, mock_databricks):
        writer = MatchResultWriter()

        writer.close()

        mock_databricks["client"].close.assert_called_once()
