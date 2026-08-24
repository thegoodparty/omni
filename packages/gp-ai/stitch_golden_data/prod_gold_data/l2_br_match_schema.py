"""Schema of record for the L2-to-BallotReady match results table.

The matcher owns this table. dbt reads it as a source and never creates it,
which is the convention in gp-data-platform already -- the expired-voters
loader creates its own tables in `databricks_utils.py` the same way. Keeping
the definition next to the writer is what keeps the two in step as the
matcher changes.

A row carrying a district is a match. A row carrying none is an attempt that
found nothing. There is no third state and no status column: a technical
error fails the run rather than being persisted.

`attempted_at` doubles as the run key -- one run stamps one value across
every row it writes -- so rolling a run back is
`delete ... where attempted_at = ?`.

Provisioning is a deliberate one-time call, not something the write path does
on every run. That keeps `CREATE TABLE` out of the privileges the matcher
needs day to day; it only needs `INSERT` once the table exists.

`create table if not exists` is a no-op once the table exists, so on its own it
would deliver a definition living beside the writer without keeping the two in
step -- add a column here later and the CREATE silently does nothing while the
INSERT fails on an unknown one. So provisioning also compares the live
columns, their types and their nullability against this definition and refuses
on a mismatch. Changing the schema after
the table exists is a migration, not a rerun.
"""

from shared.databricks_client import DatabricksClient
from shared.logger import get_logger

CATALOG = "goodparty_data_catalog"
SCHEMA = "model_predictions"
RESULTS_TABLE = "llm_l2_br_match_results"

# (name, type, nullable), in order. Compared against the live table when
# provisioning, so all three dimensions are checked rather than just the names:
# a column can agree on its name and disagree on either of the others, and a
# create-or-replace was measured to preserve comments while silently dropping
# `not null`.
RESULTS_SCHEMA: tuple[tuple[str, str, bool], ...] = (
    ("br_database_id", "int", False),
    ("l2_state", "string", True),
    ("l2_district_type", "string", True),
    ("l2_district_name", "string", True),
    ("confidence", "bigint", True),
    ("attempted_at", "timestamp", False),
)

RESULTS_COLUMNS = tuple(name for name, _, _ in RESULTS_SCHEMA)

RESULTS_DDL = f"""
create table if not exists {CATALOG}.{SCHEMA}.{RESULTS_TABLE} (
    br_database_id int not null comment 'BallotReady office database id. int, matching the cast in stg_airbyte_source__ballotready_api_position.',
    l2_state string comment 'State of the matched district. Completes the district key to (state, type, name), the grain the universe, the district mart and the overrides seed all use. Null when the attempt found nothing.',
    l2_district_type string comment 'Null when the attempt found nothing.',
    l2_district_name string comment 'Null when the attempt found nothing. Whether this is populated is what says the office matched.',
    confidence bigint comment 'Integer score, observed 0-100, not a 0-1 float. Read by the position mart confidence gates.',
    attempted_at timestamp not null comment 'When the attempt was made. Doubles as the run key: one run stamps one value across every row it writes, so a rollback is a delete on this column.'
)
"""


def results_table_path() -> str:
    return f"{CATALOG}.{SCHEMA}.{RESULTS_TABLE}"


def live_results_schema(client: DatabricksClient) -> tuple[tuple[str, str, bool], ...]:
    """The live table's (name, type, nullable) triples, in order.

    Reads `information_schema.columns` rather than `DESCRIBE TABLE`, which
    does not report nullability at all.

    `full_data_type`, not `data_type`. The view has both: `data_type` returns
    `STRING`/`INT` upper-cased and calls the confidence column `LONG`, while
    `full_data_type` returns `string`/`int`/`bigint` as the DDL spells them.
    Switching to the shorter name fails all six columns on case, which invites
    a `.lower()` that then leaves exactly one wrong -- `confidence`, whose
    divergence is the one with a downstream reader in the position mart.

    Only `column_name`, `full_data_type` and `is_nullable` are read.
    `is_identity` in this same view is a known false negative in Databricks,
    so it is trusted per-column rather than wholesale.
    """
    rows = client.execute_query(
        f"""
        select column_name, full_data_type, is_nullable
        from {CATALOG}.information_schema.columns
        where table_schema = '{SCHEMA}' and table_name = '{RESULTS_TABLE}'
        order by ordinal_position
        """
    )
    return tuple(
        (str(row.column_name), str(row.full_data_type), str(row.is_nullable).upper() == "YES")
        for row in rows.itertuples(index=False)
    )


def ensure_results_table(databricks: DatabricksClient | None = None) -> None:
    """Create the results table if absent, then verify it matches this
    definition.

    Run by hand when provisioning. The caller needs `USE SCHEMA` and
    `CREATE TABLE`; the write path afterwards needs only `INSERT`.

    Raises if the live schema differs from `RESULTS_SCHEMA`. Without that the
    CREATE would no-op against an existing table and report success while the
    two disagreed, which is the failure the write path would then hit at
    INSERT time.

    This is a provisioning gate: it runs on the one-time call and catches a
    wrong table being created. The `not_null` tests on the dbt source are the
    other half -- they run on every build and catch a right table drifting
    afterwards. Neither covers the other's window, so do not delete one as
    redundant with the other.
    """
    logger = get_logger(__name__)
    client = databricks or DatabricksClient()
    client.execute_query(RESULTS_DDL)

    live = live_results_schema(client)
    if live != RESULTS_SCHEMA:
        raise RuntimeError(
            f"{results_table_path()} does not match this definition. "
            f"Live: {live}. Expected: {RESULTS_SCHEMA}. "
            "Changing the schema of an existing table is a migration, not a rerun."
        )
    logger.info(f"{results_table_path()} exists and matches this definition")


if __name__ == "__main__":
    ensure_results_table()
