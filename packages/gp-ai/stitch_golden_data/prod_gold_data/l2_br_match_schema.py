"""Schema of record for the L2-to-BallotReady match results table.

The matcher owns this table. dbt reads it as a source and never creates it,
which is already the convention here -- the expired-voters loader creates its
own tables the same way. Keeping the definition next to the writer is what
keeps the two in step as the matcher changes.

A row carrying a district is a match. A row carrying none is an attempt that
found nothing. There is no third state and no status column: a technical error
fails the run rather than being persisted. `attempted_at` doubles as the run
key -- one run stamps one value across every row it writes -- so rolling a run
back is `delete ... where attempted_at = ?`.

Provisioning is a deliberate one-time call, not something the write path does
on every run, so `CREATE TABLE` stays out of the privileges the matcher needs
day to day; it only needs `INSERT` once the table exists.

`create table if not exists` is a no-op once the table exists, so provisioning
also compares the live schema and refuses a mismatch. Changing the schema of an
existing table is a migration, not a rerun.
"""

from shared.databricks_client import DatabricksClient
from shared.logger import get_logger

CATALOG = "goodparty_data_catalog"
SCHEMA = "model_predictions"
RESULTS_TABLE = "llm_l2_br_match_results"
RESULTS_TABLE_PATH = f"{CATALOG}.{SCHEMA}.{RESULTS_TABLE}"

# (name, type, nullable, comment), in order. The single definition: the DDL is
# generated from it and the live table is compared against it, so the two
# cannot drift. Nullability is compared as well as names because a
# create-or-replace was measured to preserve comments while silently dropping
# `not null`.
RESULTS_SCHEMA: tuple[tuple[str, str, bool, str], ...] = (
    (
        "br_database_id",
        "int",
        False,
        "BallotReady office database id. int, matching the cast in stg_airbyte_source__ballotready_api_position.",
    ),
    (
        "l2_state",
        "string",
        True,
        "State of the matched district. Completes the district key to (state, type, name), the grain the universe, "
        "the district mart and the overrides seed all use. Null when the attempt found nothing.",
    ),
    ("l2_district_type", "string", True, "Null when the attempt found nothing."),
    (
        "l2_district_name",
        "string",
        True,
        "Null when the attempt found nothing. Whether this is populated is what says the office matched.",
    ),
    (
        "confidence",
        "bigint",
        True,
        "Integer score, observed 0-100, not a 0-1 float. Read by the position mart confidence gates.",
    ),
    (
        "attempted_at",
        "timestamp",
        False,
        "When the attempt was made. Doubles as the run key: one run stamps one value across every row it writes, "
        "so a rollback is a delete on this column.",
    ),
)


def _column_clause(name: str, dtype: str, nullable: bool, comment: str) -> str:
    null_clause = "" if nullable else " not null"
    escaped = comment.replace("'", "\\'")
    return f"    {name} {dtype}{null_clause} comment '{escaped}'"


RESULTS_DDL = "create table if not exists {} (\n{}\n)".format(
    RESULTS_TABLE_PATH,
    ",\n".join(_column_clause(*column) for column in RESULTS_SCHEMA),
)


def ensure_results_table(databricks: DatabricksClient | None = None) -> None:
    """Create the results table if absent, then refuse it if it does not match
    `RESULTS_SCHEMA`.

    Run by hand when provisioning. The caller needs `USE SCHEMA` and
    `CREATE TABLE`; the write path afterwards needs only `INSERT`.

    This is a provisioning gate, so it catches a wrong table being created. The
    `not_null` tests on the dbt source are the standing half and catch a right
    table drifting afterwards. Neither covers the other's window.
    """
    logger = get_logger(__name__)
    client = databricks or DatabricksClient()
    client.execute_query(RESULTS_DDL)

    # `full_data_type`, not `data_type`. The view has both: `data_type`
    # upper-cases everything and calls the confidence column LONG, so switching
    # to the shorter name fails all six columns on case, which invites a
    # `.lower()` that then leaves `confidence` silently wrong -- the one column
    # whose divergence has a reader in the position mart. `is_identity` in this
    # same view is a known false negative, so it is trusted per-column.
    described = client.execute_query(
        f"""
        select column_name, full_data_type, is_nullable
        from {CATALOG}.information_schema.columns
        where table_schema = '{SCHEMA}' and table_name = '{RESULTS_TABLE}'
        order by ordinal_position
        """
    )
    live = tuple(
        (str(row.column_name), str(row.full_data_type), str(row.is_nullable).upper() == "YES")
        for row in described.itertuples(index=False)
    )
    expected = tuple((name, dtype, nullable) for name, dtype, nullable, _ in RESULTS_SCHEMA)
    if live != expected:
        raise RuntimeError(
            f"{RESULTS_TABLE_PATH} does not match this definition. Live: {live}. Expected: {expected}. "
            "Changing the schema of an existing table is a migration, not a rerun."
        )
    logger.info(f"{RESULTS_TABLE_PATH} exists and matches this definition")


if __name__ == "__main__":
    ensure_results_table()
