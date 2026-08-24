from unittest.mock import MagicMock

import pandas as pd
import pytest

from shared.databricks_client import DatabricksClient
from stitch_golden_data.prod_gold_data.l2_br_match_schema import (
    RESULTS_COLUMNS,
    RESULTS_DDL,
    ensure_results_table,
    results_table_path,
)


class TestSchemaOfRecord:
    """This module is the only definition of the results table -- dbt reads it
    as a source and never creates it. So a column added here without a
    corresponding writer change, or renamed without updating dbt's source,
    is only discovered when an INSERT fails against production.
    """

    def test_the_ddl_declares_exactly_the_six_agreed_columns(self):
        declared = [line.strip().split()[0] for line in RESULTS_DDL.splitlines() if line.startswith("    ")]

        assert tuple(declared) == RESULTS_COLUMNS

    def test_the_ddl_is_idempotent(self):
        # Provisioning is run by hand and may be re-run; a bare CREATE TABLE
        # would fail the second time and read as a broken migration.
        assert "create table if not exists" in RESULTS_DDL

    @staticmethod
    def _client_describing(columns):
        client = MagicMock(spec=DatabricksClient)
        client.get_table_schema.return_value = pd.DataFrame(
            {"col_name": list(columns), "data_type": ["string"] * len(columns)}
        )
        return client

    def test_ensure_results_table_executes_the_ddl_on_an_injected_client(self):
        client = self._client_describing(RESULTS_COLUMNS)

        ensure_results_table(client)

        client.execute_query.assert_called_once_with(RESULTS_DDL)

    def test_a_live_table_that_does_not_match_this_definition_is_refused(self):
        # `create table if not exists` no-ops against an existing table, so
        # without this check provisioning reports success while the live
        # schema and this definition disagree -- and the write path is what
        # then fails, at INSERT time, in production.
        client = self._client_describing(("br_database_id", "l2_state", "match_status"))

        with pytest.raises(RuntimeError, match="does not match this definition"):
            ensure_results_table(client)

    def test_describe_metadata_rows_are_not_read_as_columns(self):
        # DESCRIBE TABLE appends blocks after the columns; counting those as
        # columns would fail every provisioning run against a correct table.
        client = self._client_describing((*RESULTS_COLUMNS, "", "# Partition Information"))

        ensure_results_table(client)

    def test_the_path_matches_the_source_dbt_reads(self):
        assert results_table_path() == "goodparty_data_catalog.model_predictions.llm_l2_br_match_results"
