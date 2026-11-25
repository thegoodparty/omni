import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findProblems } from './check-databricks-lakeflow'
import {
  TEMPLATE_LOCK_KEY,
  templateDbName,
  testPostgresUri,
  withDatabase,
} from '../src/test-postgres'

// Runs the guards and the migration's event trigger against a clone of the
// schema template, which has every migration applied. Each case makes a
// change a migration could make and checks what the guards or the trigger say.
describe('Databricks CDC publication', () => {
  const dbName = `test_db_${randomBytes(8).toString('hex')}`
  let baseUri: string
  let client: Client

  beforeAll(async () => {
    baseUri = await testPostgresUri()
    const admin = new Client({ connectionString: baseUri })
    await admin.connect()
    try {
      await admin.query(`SELECT pg_advisory_lock_shared(${TEMPLATE_LOCK_KEY})`)
      await admin.query(
        `CREATE DATABASE ${dbName} TEMPLATE ${templateDbName()}`,
      )
    } finally {
      await admin.query(
        `SELECT pg_advisory_unlock_shared(${TEMPLATE_LOCK_KEY})`,
      )
      await admin.end()
    }
    client = new Client({ connectionString: withDatabase(baseUri, dbName) })
    await client.connect()
  }, 60_000)

  afterAll(async () => {
    await client.end()
    const admin = new Client({ connectionString: baseUri })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await admin.end()
  }, 60_000)

  const published = async (table: string) =>
    (
      await client.query(
        `SELECT attnames::text[] AS attnames FROM pg_publication_tables
          WHERE pubname = 'databricks_lakeflow' AND schemaname = 'public'
            AND tablename = $1`,
        [table],
      )
    ).rows[0] as { attnames: string[] } | undefined

  it('passes on the migrated schema', async () => {
    expect(await findProblems(client)).toEqual([])
  })

  it('publishes every public table and no secret column', async () => {
    expect((await published('user'))?.attnames).toContain('email')
    expect((await published('user'))?.attnames).not.toContain('password')
    expect((await published('peerly_phone_list'))?.attnames).not.toContain(
      'token',
    )
    expect((await published('outreach_email_sender'))?.attnames).not.toContain(
      'pending_forward_token_hash',
    )
    expect((await published('campaign'))?.attnames).toContain('id')
  })

  it('publishes a new table, and the guard flags one without a key', async () => {
    try {
      await client.query('CREATE TABLE public.cdc_guard_a (id int)')
      expect(await published('cdc_guard_a')).toBeDefined()
      expect(await findProblems(client)).toEqual([
        expect.stringContaining('public.cdc_guard_a has no primary key'),
      ])
    } finally {
      await client.query('DROP TABLE IF EXISTS public.cdc_guard_a')
    }
    expect(await findProblems(client)).toEqual([])
  })

  it('flags a table that is missing from the publication', async () => {
    try {
      await client.query('ALTER EVENT TRIGGER databricks_lakeflow_sync DISABLE')
      await client.query('CREATE TABLE public.cdc_guard_b (id int PRIMARY KEY)')
      expect(await findProblems(client)).toEqual([
        expect.stringContaining('public.cdc_guard_b is not in publication'),
      ])
    } finally {
      await client.query('ALTER EVENT TRIGGER databricks_lakeflow_sync ENABLE')
      await client.query('DROP TABLE IF EXISTS public.cdc_guard_b')
    }
    expect(await findProblems(client)).toEqual([])
  })

  it('flags an unreviewed column that looks like a secret', async () => {
    try {
      await client.query(
        'CREATE TABLE public.cdc_guard_c (id int PRIMARY KEY, api_key text)',
      )
      expect(await findProblems(client)).toEqual([
        expect.stringContaining(
          'public.cdc_guard_c.api_key looks like a secret',
        ),
      ])
    } finally {
      await client.query('DROP TABLE IF EXISTS public.cdc_guard_c')
    }
  })

  it('keeps secrets out when a secret table gains and loses columns', async () => {
    try {
      await client.query('ALTER TABLE public."user" ADD COLUMN cdc_guard_d int')
      expect((await published('user'))?.attnames).toContain('cdc_guard_d')
      expect((await published('user'))?.attnames).not.toContain('password')
      const grants = await client.query(
        `SELECT
           has_column_privilege('databricks_lakeflow', 'public.user', 'cdc_guard_d', 'SELECT') AS added,
           has_column_privilege('databricks_lakeflow', 'public.user', 'password', 'SELECT') AS password,
           has_column_privilege('databricks_lakeflow', 'public.user', 'password_reset_token', 'SELECT') AS reset_token`,
      )
      expect(grants.rows[0]).toEqual({
        added: true,
        password: false,
        reset_token: false,
      })
    } finally {
      await client.query(
        'ALTER TABLE public."user" DROP COLUMN IF EXISTS cdc_guard_d',
      )
    }
    expect((await published('user'))?.attnames).not.toContain('cdc_guard_d')
    expect(await findProblems(client)).toEqual([])
  })

  it('can run the sync again and leave the same publication', async () => {
    const before = await client.query(
      `SELECT count(*)::int AS n FROM pg_publication_tables
        WHERE pubname = 'databricks_lakeflow'`,
    )
    await client.query('SELECT public.databricks_lakeflow_sync()')
    const after = await client.query(
      `SELECT count(*)::int AS n FROM pg_publication_tables
        WHERE pubname = 'databricks_lakeflow'`,
    )
    expect(after.rows[0]).toEqual(before.rows[0])
  })
})
