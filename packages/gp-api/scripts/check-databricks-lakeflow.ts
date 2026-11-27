import { Client, QueryResultRow } from 'pg'

// Guards for the Databricks Lakeflow CDC publication. Run against a database
// that has had every migration applied (CI: `prisma migrate deploy` first).
// The Postgres side is prisma/schema/migrations/*_add_databricks_lakeflow_replication;
// the background is deploy/AGENTS.md, "Postgres objects".

// Columns whose name looks like a secret but is not one, each reviewed by a
// person. A new match fails the check until it is either added to the secret
// map (the migration's databricks_lakeflow_secret_columns(), plus the
// pipeline's exclude_columns) or listed here with its reason.
export const REVIEWED_COLUMNS: Record<string, string> = {
  'agent_message.cache_read_tokens': 'LLM token count',
  'agent_message.cache_write_tokens': 'LLM token count',
  'agent_message.input_tokens': 'LLM token count',
  'agent_message.output_tokens': 'LLM token count',
  'ordinance.flow_input_tokens': 'LLM token count',
  'ordinance.flow_output_tokens': 'LLM token count',
  'ordinance.loop_input_tokens': 'LLM token count',
  'ordinance.loop_output_tokens': 'LLM token count',
  'ordinance.qc_input_tokens': 'LLM token count',
  'ordinance.qc_output_tokens': 'LLM token count',
  'ordinance_quality_iteration.tokens': 'LLM token count',
  'user.has_password': 'boolean flag, not the hash',
}

export const SECRET_COLUMN_PATTERN =
  /(password|token|secret|api_?key|credential|private|ssn)/i

const PUBLICATION = 'databricks_lakeflow'

const rows = async <T extends QueryResultRow>(
  client: Client,
  sql: string,
): Promise<T[]> => (await client.query<T>(sql)).rows

/** Returns one message per violation. An empty list means the guards pass. */
export const findProblems = async (client: Client): Promise<string[]> => {
  const problems: string[] = []

  const withoutPrimaryKey = await rows<{ table_name: string }>(
    client,
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint k
           WHERE k.conrelid = c.oid AND k.contype = 'p')
      ORDER BY 1`,
  )
  for (const { table_name } of withoutPrimaryKey) {
    problems.push(
      `public.${table_name} has no primary key. The CDC publication ` +
        'publishes updates and deletes, and Postgres rejects them on a table ' +
        'with no replica identity. Add a primary key.',
    )
  }

  const publication = await rows<{ found: number }>(
    client,
    `SELECT 1 AS found FROM pg_publication WHERE pubname = '${PUBLICATION}'`,
  )
  if (publication.length === 0) {
    problems.push(
      `Publication ${PUBLICATION} does not exist. The ` +
        'add_databricks_lakeflow_replication migration creates it.',
    )
  } else {
    const missing = await rows<{ table_name: string }>(
      client,
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relispartition
          AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables p
             WHERE p.pubname = '${PUBLICATION}'
               AND p.schemaname = 'public'
               AND p.tablename = c.relname)
        ORDER BY 1`,
    )
    for (const { table_name } of missing) {
      problems.push(
        `public.${table_name} is not in publication ${PUBLICATION}, so ` +
          'Databricks would not receive it. The event trigger ' +
          'databricks_lakeflow_sync should have added it.',
      )
    }
    const extra = await rows<{ schemaname: string; tablename: string }>(
      client,
      `SELECT p.schemaname, p.tablename
         FROM pg_publication_tables p
        WHERE p.pubname = '${PUBLICATION}'
          AND NOT EXISTS (
            SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = p.schemaname
               AND c.relname = p.tablename
               AND p.schemaname = 'public')
        ORDER BY 1, 2`,
    )
    for (const { schemaname, tablename } of extra) {
      problems.push(
        `${schemaname}.${tablename} is in publication ${PUBLICATION} but ` +
          'only tables in public belong there.',
      )
    }
    // Names only, never values. A secret column left in a column list would
    // reach the WAL stream, so check the lists as well as the grants.
    const leaked = await rows<{ table_name: string; column_name: string }>(
      client,
      `SELECT s.table_name, s.column_name
         FROM public.databricks_lakeflow_secret_columns() s
         JOIN pg_publication_tables p
           ON p.pubname = '${PUBLICATION}'
          AND p.schemaname = 'public'
          AND p.tablename = s.table_name
        WHERE s.column_name = ANY (p.attnames)
        ORDER BY 1, 2`,
    )
    for (const { table_name, column_name } of leaked) {
      problems.push(
        `Secret column public.${table_name}.${column_name} is in the ` +
          `publication ${PUBLICATION}.`,
      )
    }
  }

  const secrets = new Set(
    (
      await rows<{ table_name: string; column_name: string }>(
        client,
        'SELECT table_name, column_name FROM public.databricks_lakeflow_secret_columns()',
      )
    ).map((row) => `${row.table_name}.${row.column_name}`),
  )
  const columns = await rows<{ table_name: string; column_name: string }>(
    client,
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )
  for (const { table_name, column_name } of columns) {
    const name = `${table_name}.${column_name}`
    if (
      SECRET_COLUMN_PATTERN.test(column_name) &&
      !secrets.has(name) &&
      !(name in REVIEWED_COLUMNS)
    ) {
      problems.push(
        `public.${name} looks like a secret. If it is, add it to ` +
          'databricks_lakeflow_secret_columns() in a new migration, to ' +
          "the pipeline's exclude_columns in gp-terraform-dataplatform, and " +
          'to the federation role (deploy/databricks/federation/README.md). ' +
          'If it is not, add it to REVIEWED_COLUMNS in ' +
          'scripts/check-databricks-lakeflow.ts with the reason.',
      )
    }
  }

  return problems
}

const main = async () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set.')
    process.exit(2)
  }
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const problems = await findProblems(client)
    if (problems.length === 0) {
      console.log(
        'Databricks CDC: publication and secret columns are in order.',
      )
      return
    }
    for (const problem of problems) console.error(`- ${problem}`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

if (require.main === module) void main()
