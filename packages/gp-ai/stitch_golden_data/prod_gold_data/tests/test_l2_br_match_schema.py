from unittest.mock import MagicMock

import pandas as pd
import pytest

from shared.databricks_client import DatabricksClient
from stitch_golden_data.prod_gold_data.l2_br_match_schema import (
    RESULTS_COLUMNS,
    RESULTS_DDL,
    RESULTS_SCHEMA,
    ensure_results_table,
    results_table_path,
)


def _ddl_columns() -> tuple[tuple[str, str, bool], ...]:
    """(name, type, nullable) as the DDL text declares them."""
    parsed = []
    for line in RESULTS_DDL.splitlines():
        if not line.startswith("    "):
            continue
        tokens = line.strip().split()
        parsed.append((tokens[0], tokens[1], "not null" not in line))
    return tuple(parsed)


class TestTheTwoDeclarationsAgree:
    """RESULTS_DDL is what creates the table and RESULTS_SCHEMA is what the
    live table is compared against, so they must say the same thing. If they
    drift, provisioning creates one shape and then refuses it.
    """

    def test_the_ddl_matches_the_structured_schema(self):
        assert _ddl_columns() == RESULTS_SCHEMA

    def test_the_ddl_is_idempotent(self):
        # Provisioning is run by hand and may be re-run; a bare CREATE TABLE
        # would fail the second time and read as a broken migration.
        assert "create table if not exists" in RESULTS_DDL

    def test_the_path_matches_the_source_dbt_reads(self):
        assert results_table_path() == "goodparty_data_catalog.model_predictions.llm_l2_br_match_results"


class TestProvisioningRefusesADivergentTable:
    """`create table if not exists` no-ops against an existing table, so
    without comparing the live schema provisioning reports success while the
    two disagree, and the write path is what fails, in production. A
    create-or-replace was measured to preserve comments while silently
    dropping `not null`, so names alone are not enough to compare.
    """

    @staticmethod
    def _client_returning(triples):
        client = MagicMock(spec=DatabricksClient)
        client.execute_query.side_effect = lambda sql: (
            pd.DataFrame(
                {
                    "column_name": [name for name, _, _ in triples],
                    "full_data_type": [dtype for _, dtype, _ in triples],
                    "is_nullable": ["YES" if nullable else "NO" for _, _, nullable in triples],
                }
            )
            if "information_schema" in sql
            else pd.DataFrame()
        )
        return client

    def test_the_query_reads_full_data_type_not_data_type(self):
        # information_schema has both. `data_type` upper-cases everything and
        # calls the confidence column LONG; `full_data_type` spells types as
        # the DDL does. Switching to the shorter name fails all six columns on
        # case, which invites a `.lower()` that then leaves `confidence`
        # silently wrong -- and that is the column the position mart's
        # confidence gates read. Every other test here mocks the client, so
        # nothing else would catch the swap.
        client = self._client_returning(RESULTS_SCHEMA)

        ensure_results_table(client)

        queries = [c.args[0] for c in client.execute_query.call_args_list]
        schema_query = next(q for q in queries if "information_schema" in q)
        assert "full_data_type" in schema_query
        assert "data_type" not in schema_query.replace("full_data_type", "")

    def test_a_matching_table_is_accepted(self):
        client = self._client_returning(RESULTS_SCHEMA)

        ensure_results_table(client)

        assert any("create table if not exists" in c.args[0] for c in client.execute_query.call_args_list)

    @pytest.mark.parametrize(
        "live",
        [
            RESULTS_SCHEMA[:-1],
            tuple((name, dtype, True) for name, dtype, _ in RESULTS_SCHEMA),
            tuple(
                (name, "string" if name == "confidence" else dtype, nullable)
                for name, dtype, nullable in RESULTS_SCHEMA
            ),
            (RESULTS_SCHEMA[1], RESULTS_SCHEMA[0], *RESULTS_SCHEMA[2:]),
        ],
        ids=["a-column-is-missing", "not-null-was-lost", "a-type-changed", "the-order-changed"],
    )
    def test_a_divergent_live_table_is_refused(self, live):
        client = self._client_returning(live)

        with pytest.raises(RuntimeError, match="does not match this definition"):
            ensure_results_table(client)


def test_results_columns_is_derived_from_the_schema():
    assert RESULTS_COLUMNS == tuple(name for name, _, _ in RESULTS_SCHEMA)
