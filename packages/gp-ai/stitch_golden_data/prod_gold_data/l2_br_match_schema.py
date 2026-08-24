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
INSERT fails on an unknown one. So provisioning also compares the live columns
against this definition and refuses on a mismatch. Changing the schema after
the table exists is a migration, not a rerun.
"""

from shared.databricks_client import DatabricksClient
from shared.logger import get_logger

CATALOG = "goodparty_data_catalog"
SCHEMA = "model_predictions"
RESULTS_TABLE = "llm_l2_br_match_results"

RESULTS_COLUMNS = (
    "br_database_id",
    "l2_state",
    "l2_district_type",
    "l2_district_name",
    "confidence",
    "attempted_at",
)

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


def live_results_columns(client: DatabricksClient) -> tuple[str, ...]:
    """The live table's column names, in order.

    DESCRIBE TABLE appends metadata blocks (partition info, and similar) after
    the columns, each introduced by a blank or `#`-prefixed name, so those are
    dropped.
    """
    described = client.get_table_schema(CATALOG, SCHEMA, RESULTS_TABLE)
    names = [str(name) for name in described["col_name"]]
    return tuple(name for name in names if name and not name.startswith("#"))


def ensure_results_table(databricks: DatabricksClient | None = None) -> None:
    """Create the results table if absent, then verify it matches this
    definition.

    Run by hand when provisioning. The caller needs `USE SCHEMA` and
    `CREATE TABLE`; the write path afterwards needs only `INSERT`.

    Raises if the live table's columns differ from `RESULTS_COLUMNS`. Without
    that the CREATE would no-op against an existing table and report success
    while the two disagreed, which is the failure the write path would then
    hit at INSERT time.
    """
    logger = get_logger(__name__)
    client = databricks or DatabricksClient()
    client.execute_query(RESULTS_DDL)

    live = live_results_columns(client)
    if live != RESULTS_COLUMNS:
        raise RuntimeError(
            f"{results_table_path()} does not match this definition. "
            f"Live: {live}. Expected: {RESULTS_COLUMNS}. "
            "Changing the schema of an existing table is a migration, not a rerun."
        )
    logger.info(f"{results_table_path()} exists and matches this definition")


if __name__ == "__main__":
    ensure_results_table()
