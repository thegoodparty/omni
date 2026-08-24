from unittest.mock import MagicMock

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

    def test_ensure_results_table_executes_the_ddl_on_an_injected_client(self):
        client = MagicMock(spec=DatabricksClient)

        ensure_results_table(client)

        client.execute_query.assert_called_once_with(RESULTS_DDL)

    def test_the_path_matches_the_source_dbt_reads(self):
        assert results_table_path() == "goodparty_data_catalog.model_predictions.llm_l2_br_match_results"
