# One view per mirror table, with every source `timestamp without time zone`
# column (each Prisma DateTime) cast back from the STRING Lakeflow lands it as.
# The source's own information_schema says which columns those are, read
# through the gateway's connection, because no naming rule covers them all.
import sys

from pyspark.sql import SparkSession

catalog, mirror, typed, connection, database = sys.argv[1:6]
spark = SparkSession.builder.getOrCreate()


def quote(name):
    return "`" + name.replace("`", "``") + "`"


columns = spark.sql(
    f"""
    SELECT table_name, column_name, data_type
    FROM remote_query(
      '{connection}',
      database => '{database}',
      dbtable => 'information_schema.columns'
    )
    WHERE table_schema = 'public'
    """
).collect()
source_tables = {row.table_name for row in columns}
timestamps = {
    (row.table_name, row.column_name)
    for row in columns
    if row.data_type == "timestamp without time zone"
}

for table in spark.sql(f"SHOW TABLES IN {quote(catalog)}.{quote(mirror)}").collect():
    name = table.tableName
    if name not in source_tables:
        continue
    source = f"{quote(catalog)}.{quote(mirror)}.{quote(name)}"
    # Prisma writes UTC, and the Z keeps the cast independent of the reader's
    # session time zone. try_cast turns Postgres 'infinity' into NULL.
    select = ", ".join(
        f"try_cast(concat({quote(c)}, 'Z') AS TIMESTAMP) AS {quote(c)}"
        if (name, c) in timestamps
        else quote(c)
        for c in spark.table(source).columns
    )
    spark.sql(
        f"CREATE OR REPLACE VIEW {quote(catalog)}.{quote(typed)}.{quote(name)} "
        f"AS SELECT {select} FROM {source}"
    )
