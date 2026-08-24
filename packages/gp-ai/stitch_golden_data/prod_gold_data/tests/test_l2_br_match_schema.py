from unittest.mock import MagicMock

import pandas as pd
import pytest

from shared.databricks_client import DatabricksClient
from stitch_golden_data.prod_gold_data.l2_br_match_schema import (
    RESULTS_DDL,
    RESULTS_SCHEMA,
    ensure_results_table,
)


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


def test_the_generated_ddl_carries_not_null_and_the_comments():
    """The generator drops `not null` or a comment, so the created table
    diverges from the definition it was generated from.
    """
    for name, dtype, nullable, comment in RESULTS_SCHEMA:
        clause = next(line for line in RESULTS_DDL.splitlines() if line.strip().startswith(f"{name} "))
        assert f"{name} {dtype}" in clause
        assert ("not null" in clause) is not nullable
        assert comment.replace("'", "\\'") in clause


def test_the_query_reads_full_data_type_not_data_type():
    """Switching to `data_type` fails every column on case, which invites a
    `.lower()` that then leaves `confidence` silently wrong. Every other test
    here mocks the client, so nothing else catches the swap.
    """
    expected = tuple((name, dtype, nullable) for name, dtype, nullable, _ in RESULTS_SCHEMA)
    client = _client_returning(expected)

    ensure_results_table(client)

    queries = [call.args[0] for call in client.execute_query.call_args_list]
    assert any("create table if not exists" in q for q in queries)
    schema_query = next(q for q in queries if "information_schema" in q)
    assert "full_data_type" in schema_query
    assert "data_type" not in schema_query.replace("full_data_type", "")


@pytest.mark.parametrize(
    "live",
    [
        tuple((n, d, x) for n, d, x, _ in RESULTS_SCHEMA)[:-1],
        tuple((n, d, True) for n, d, _, _ in RESULTS_SCHEMA),
        tuple((n, "string" if n == "confidence" else d, x) for n, d, x, _ in RESULTS_SCHEMA),
        tuple((n, d, x) for n, d, x, _ in (RESULTS_SCHEMA[1], RESULTS_SCHEMA[0], *RESULTS_SCHEMA[2:])),
    ],
    ids=["a-column-is-missing", "not-null-was-lost", "a-type-changed", "the-order-changed"],
)
def test_a_divergent_live_table_is_refused(live):
    """`create table if not exists` no-ops against an existing table, so
    without this provisioning reports success while the two disagree and the
    write path is what fails, in production.
    """
    with pytest.raises(RuntimeError, match="does not match this definition"):
        ensure_results_table(_client_returning(live))
