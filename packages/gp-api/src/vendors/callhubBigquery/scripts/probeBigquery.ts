/*
 * probeBigquery.ts — READ-ONLY discovery probe for CallHub's BigQuery export.
 *
 * Purpose: once CallHub grants our service account read access, use this to (a)
 * confirm the grant is live, and (b) discover the dataset's schema so the
 * blocked results reader (callhubBigqueryResults.service.ts) can be written
 * against real column names. It never writes — only lists datasets/tables,
 * reads INFORMATION_SCHEMA, counts rows, and prints a few sample rows with
 * phone/contact columns REDACTED so no real voter numbers reach the terminal.
 *
 * Run (from packages/gp-api):
 *   CALLHUB_BQ_PROJECT_ID=<callhub-project> \
 *   CALLHUB_BQ_DATASET=<dataset> \
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json \
 *     npx tsx src/vendors/callhubBigquery/scripts/probeBigquery.ts
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS (ADC key path, preferred) or the
 * inline CALLHUB_BQ_SA_KEY_JSON. CLI args override the env:
 *   --project <id>  --dataset <name>  --table <name>
 * With --table, only that table is inspected; otherwise every table in the
 * dataset is listed and the first few are sampled.
 */
import { BigQuery } from '@google-cloud/bigquery'
import {
  readBigqueryCredentials,
  readBigqueryDataset,
  readBigqueryProjectId,
} from '../config/callhubBigqueryConfig'
import {
  getBigqueryErrorCode,
  isPermanentBigqueryError,
} from '../services/bigqueryErrorHandling.service'
import { BigqueryCell, redactRow } from './redactRow'

type QueryResult = [unknown, ...unknown[]]

// BigQuery types every row as `any`; the probe only reads/prints known columns.
const asRows = <T>(result: QueryResult): T[] =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  (result[0] ?? []) as T[]

const SAMPLE_LIMIT = 5
const MAX_TABLES_TO_SAMPLE = 3

// BigQuery identifiers cannot be passed as query parameters, so the few we must
// interpolate (project / dataset / table) are validated to a strict charset
// first — this is the only defence against injection through those names.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/

const assertSafeIdentifier = (value: string, label: string): string => {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Unsafe ${label} identifier: ${value}`)
  }
  return value
}

const readArg = (flag: string): string | undefined => {
  const argv = process.argv
  const index = argv.indexOf(flag)
  if (index !== -1 && index + 1 < argv.length) {
    return argv[index + 1]
  }
  const inline = argv.find((a) => a.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : undefined
}

interface TableRow {
  table_name: string
  table_type: string
}

interface ColumnRow {
  column_name: string
  data_type: string
}

interface CountRow {
  n: number | string
}

// Prints a friendly, actionable line for the access/permission failures this
// probe exists to diagnose, instead of a stack trace.
const explainError = (context: string, error: unknown): void => {
  const code = getBigqueryErrorCode(error)
  if (code === 401 || code === 403) {
    console.error(
      `\n[${context}] Access not granted yet (or wrong project). Got ${code}. ` +
        "The service account needs BigQuery Data Viewer on CallHub's dataset " +
        'and BigQuery Job User in the billing project. Re-run once CallHub ' +
        'confirms the grant.',
    )
    return
  }
  if (code === 404) {
    console.error(
      `\n[${context}] Not found (404). Check CALLHUB_BQ_PROJECT_ID and ` +
        'CALLHUB_BQ_DATASET — the dataset or table name may be wrong.',
    )
    return
  }
  const permanent = isPermanentBigqueryError(error)
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `\n[${context}] ${permanent ? 'Permanent' : 'Transient'} error ` +
      `(code ${String(code)}): ${message}`,
  )
}

const listDatasets = async (bigquery: BigQuery): Promise<void> => {
  console.log('\n=== Datasets visible to the service account ===')
  try {
    const [datasets] = await bigquery.getDatasets()
    if (datasets.length === 0) {
      console.log('(none — the account can authenticate but sees no datasets)')
      return
    }
    for (const dataset of datasets) {
      console.log(`- ${dataset.id ?? '(unknown id)'}`)
    }
  } catch (error) {
    explainError('list datasets', error)
  }
}

const listTables = async (
  bigquery: BigQuery,
  project: string,
  dataset: string,
): Promise<string[]> => {
  console.log(`\n=== Tables in ${project}.${dataset} ===`)
  try {
    const tables = asRows<TableRow>(
      await bigquery.query({
        query:
          `SELECT table_name, table_type FROM ` +
          `\`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\` ` +
          `ORDER BY table_name`,
        useLegacySql: false,
      }),
    )
    if (tables.length === 0) {
      console.log('(no tables)')
      return []
    }
    for (const table of tables) {
      console.log(`- ${table.table_name} (${table.table_type})`)
    }
    return tables.map((t) => t.table_name)
  } catch (error) {
    explainError('list tables', error)
    return []
  }
}

const describeTable = async (
  bigquery: BigQuery,
  project: string,
  dataset: string,
  table: string,
): Promise<void> => {
  assertSafeIdentifier(table, 'table')
  console.log(`\n=== ${project}.${dataset}.${table} ===`)
  try {
    const columnRows = asRows<ColumnRow>(
      await bigquery.query({
        query:
          `SELECT column_name, data_type FROM ` +
          `\`${project}.${dataset}.INFORMATION_SCHEMA.COLUMNS\` ` +
          `WHERE table_name = @table ORDER BY ordinal_position`,
        params: { table },
        useLegacySql: false,
      }),
    )
    console.log('Columns:')
    for (const column of columnRows) {
      console.log(`  - ${column.column_name}: ${column.data_type}`)
    }

    const countRows = asRows<CountRow>(
      await bigquery.query({
        query: `SELECT COUNT(*) AS n FROM \`${project}.${dataset}.${table}\``,
        useLegacySql: false,
      }),
    )
    console.log(`Row count: ${String(countRows[0]?.n ?? '?')}`)

    const sampleRows = asRows<Record<string, BigqueryCell>>(
      await bigquery.query({
        query:
          `SELECT * FROM \`${project}.${dataset}.${table}\` ` +
          `LIMIT ${SAMPLE_LIMIT}`,
        useLegacySql: false,
      }),
    )
    console.log(`Sample rows (max ${SAMPLE_LIMIT}, phone/contact redacted):`)
    for (const row of sampleRows) {
      console.log(`  ${JSON.stringify(redactRow(row))}`)
    }
  } catch (error) {
    explainError(`describe ${table}`, error)
  }
}

const main = async (): Promise<void> => {
  const project = assertSafeIdentifier(
    readArg('--project') ?? readBigqueryProjectId(),
    'project',
  )
  const dataset = assertSafeIdentifier(
    readArg('--dataset') ?? readBigqueryDataset(),
    'dataset',
  )
  const onlyTable = readArg('--table')

  console.log('CallHub BigQuery probe — READ-ONLY')
  console.log(`Project: ${project}`)
  console.log(`Dataset: ${dataset}`)

  const bigquery = new BigQuery({
    projectId: project,
    ...readBigqueryCredentials(),
  })

  await listDatasets(bigquery)

  if (onlyTable) {
    await describeTable(bigquery, project, dataset, onlyTable)
    return
  }

  const tables = await listTables(bigquery, project, dataset)
  for (const table of tables.slice(0, MAX_TABLES_TO_SAMPLE)) {
    await describeTable(bigquery, project, dataset, table)
  }
  if (tables.length > MAX_TABLES_TO_SAMPLE) {
    console.log(
      `\n(${tables.length - MAX_TABLES_TO_SAMPLE} more tables not sampled; ` +
        'pass --table <name> to inspect one.)',
    )
  }
}

main().catch((error) => {
  explainError('probe', error)
  process.exitCode = 1
})
