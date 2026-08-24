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


def ensure_results_table(databricks: DatabricksClient | None = None) -> None:
    """Create the results table if it is absent. Idempotent.

    Run once, by hand, when provisioning. The caller needs `USE SCHEMA` and
    `CREATE TABLE` on the schema; the write path afterwards needs only
    `INSERT`.
    """
    logger = get_logger(__name__)
    client = databricks or DatabricksClient()
    client.execute_query(RESULTS_DDL)
    logger.info(f"Ensured {results_table_path()} exists")


if __name__ == "__main__":
    ensure_results_table()
