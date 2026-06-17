/**
 * Introspect the constituent-data mart and regenerate the dimension allowlist.
 *
 * Usage:
 *   npx tsx scripts/describe-serve-agent-voters.ts
 *
 * Reads the live schema of
 * goodparty_data_catalog.mart_serve_agents.serve_agent_voters via DESCRIBE
 * TABLE (column names + types + comments only — NO rows, no individual/PII
 * records). The table is the approved allowlist, curated upstream by research +
 * product, so when its columns change, run this and paste the printed array
 * into src/chats/general/chief-of-staff/services/constituentDimensions.serveAgentVoters.ts
 * (voter_key is intentionally excluded — it is the identifier / count key).
 *
 * Requires DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, and either OAuth
 * M2M creds (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET) or a PAT
 * (DATABRICKS_API_KEY) in packages/gp-api/.env.
 */
import '../src/configrc'
import { DatabricksSqlProvider } from '../src/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '../src/llm/tools/databricksConnection'

const TABLE = 'goodparty_data_catalog.mart_serve_agents.serve_agent_voters'

const main = async () => {
  const conn = resolveDatabricksConnection()
  if (!conn) {
    console.error(
      'Missing Databricks config. Need DATABRICKS_SERVER_HOSTNAME, ' +
        'DATABRICKS_HTTP_PATH, and either DATABRICKS_CLIENT_ID + ' +
        'DATABRICKS_CLIENT_SECRET (OAuth) or DATABRICKS_API_KEY (PAT).',
    )
    process.exit(1)
  }
  const auth = conn.oauthClientId ? 'oauth (client id + secret)' : 'pat'
  console.log(`auth: ${auth}`)
  const provider = new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_serve_agents',
  })
  const result = await provider.query(`DESCRIBE TABLE ${TABLE}`)
  const cols = (result.rows ?? []).filter((r) => {
    const name = String(r.col_name ?? r.column_name ?? '')
    return name.length > 0 && !name.startsWith('#')
  })
  console.log(`\n${cols.length} columns in ${TABLE}:\n`)
  for (const r of cols) {
    const name = String(r.col_name ?? r.column_name ?? '')
    const type = String(r.data_type ?? r.dataType ?? '')
    const comment = String(r.comment ?? '')
    console.log(`  ${name}\t${type}\t${comment}`)
  }
  const dims = cols
    .map((r) => String(r.col_name ?? r.column_name ?? ''))
    .filter((n) => n !== 'voter_key')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  console.log(
    `\nDIMENSIONS (${dims.length}):\n` +
      dims.map((n) => `  '${n}',`).join('\n'),
  )
  await provider.close()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
