import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { z } from 'zod'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { AgentsService } from '@/agents/agents.service'
import { defineAgent } from '@/agents/defineAgent'
import { ElectionsService } from '@/elections/services/elections.service'
import { AgentMessageRole } from '@/generated/prisma'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { useTestService } from '@/test-service'
import type { ToolContext } from './tool'
import {
  databricksTool,
  orgDatabricksScope,
  type DatabricksScope,
} from './queryDatabricks'

const service = useTestService({ jobs: true })

const TABLE = 'goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq'
const SCOPE: DatabricksScope = { state: 'IL' }

const tool = databricksTool({
  tables: [TABLE],
  maxRows: 2,
  scope: async () => SCOPE,
})

const ctx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  runId: 'run-1',
  stepKey: '0:queryDatabricks:0',
  organizationSlug: 'org',
  signal: new AbortController().signal,
  get: (type) => service.app.get(type, { strict: false }),
  ...overrides,
})

const rows = (count: number): string[][] =>
  Array.from({ length: count }, (_, i) => [`issue-${i}`, String(i)])

let query: Mock<PeopleDbxStatementClient['query']>

beforeAll(() => {
  query = vi.fn<PeopleDbxStatementClient['query']>()
  vi.spyOn(
    service.app.get(PeopleDbxStatementClient),
    'query',
  ).mockImplementation((...args) => query(...args))
})

afterEach(() => {
  query.mockReset()
})

describe('queryDatabricks', () => {
  const runs = (sql: string) =>
    tool.execute({ sql }, ctx()) as Promise<Record<string, unknown>>

  it('runs one scoped SELECT and returns its columns and rows', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(2) })

    await expect(
      runs(
        `SELECT title, COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'
         GROUP BY title LIMIT 50`,
      ),
    ).resolves.toEqual({
      ok: true,
      columns: ['title', 'n'],
      rows: rows(2),
      rowCount: 2,
      truncated: false,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('accepts a bare table name and a schema-qualified one', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    for (const ref of [
      'dbt.int__l2_nationwide_uniform_w_haystaq',
      'int__l2_nationwide_uniform_w_haystaq',
    ]) {
      await expect(
        runs(
          `SELECT COUNT(*) AS n FROM ${ref} WHERE Residence_Addresses_State = 'IL'`,
        ),
      ).resolves.toMatchObject({ ok: true })
    }
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('refuses a table the agent was not granted', async () => {
    const result = await runs(
      `SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters
       WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('is not an allowed table')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a spoofed catalog that shares the allowed table name', async () => {
    const result = await runs(
      `SELECT * FROM evil_catalog.public.int__l2_nationwide_uniform_w_haystaq
       WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    ['write', `INSERT INTO ${TABLE} VALUES ('IL')`],
    ['update', `UPDATE ${TABLE} SET title = 'x'`],
    ['delete', `DELETE FROM ${TABLE}`],
    ['DDL', 'CREATE TABLE t (a INT)'],
    ['drop', `DROP TABLE ${TABLE}`],
  ])('refuses a %s statement', async (_label, sql) => {
    const result = await runs(sql)

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses two statements even when the second is a harmless SELECT', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'; SELECT 1`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('exactly one SELECT')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a write hidden after a block comment', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' /* ; */
       ; DROP TABLE ${TABLE}`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a table function in place of a table', async () => {
    const result = await runs(
      `SELECT * FROM read_files('/etc/passwd') WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a CTE whose body reads a table outside the grant', async () => {
    const result = await runs(
      `WITH stolen AS (
         SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters
         WHERE Residence_Addresses_State = 'IL'
       )
       SELECT * FROM stolen`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('gp_api_voters')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a self-join that would satisfy the filter for one alias only', async () => {
    const result = await runs(
      `SELECT a.title FROM ${TABLE} a
       JOIN ${TABLE} b ON a.title = b.title
       WHERE a.Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a CTE whose body reads the allowed table unscoped', async () => {
    const result = await runs(
      `WITH everyone AS (SELECT title FROM ${TABLE})
       SELECT COUNT(*) AS n FROM everyone WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('Residence_Addresses_State')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a UNION branch that reads the table unscoped', async () => {
    const result = await runs(
      `SELECT title FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'
       UNION ALL
       SELECT title FROM ${TABLE}`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a query with no jurisdiction filter at all', async () => {
    const result = await runs(`SELECT COUNT(*) AS n FROM ${TABLE}`)

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain("Residence_Addresses_State = 'IL'")
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a filter an OR could step around', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE}
       WHERE Residence_Addresses_State = 'IL' OR 1 = 1`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a filter pinned to another state', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'CA'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires the district column too when the org has a district', async () => {
    const scoped = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => ({
        state: 'NC',
        district: { column: 'City_Ward', value: 'FAYETTEVILLE CITY WARD 2' },
      }),
    })
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    const missing = await scoped.execute(
      {
        sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'NC'`,
      },
      ctx(),
    )
    expect(missing).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String((missing as { detail: string }).detail)).toContain(
      'City_Ward',
    )

    await expect(
      scoped.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE}
                WHERE Residence_Addresses_State = 'NC'
                  AND \`City_Ward\` = 'FAYETTEVILLE CITY WARD 2'`,
        },
        ctx(),
      ),
    ).resolves.toMatchObject({ ok: true })
  })

  it('truncates the result at the row cap and says so', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(5) })

    const result = await runs(
      `SELECT title, COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({
      ok: true,
      rows: rows(2),
      rowCount: 2,
      truncated: true,
    })
  })

  it('gives up at its own statement ceiling and cancels the query', async () => {
    let seen: AbortSignal | undefined
    query.mockImplementation((_statement, options) => {
      seen = options?.signal
      return new Promise(() => undefined)
    })
    const timed = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => SCOPE,
      statementTimeoutMs: 20,
    })

    const result = await timed.execute(
      {
        sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
      },
      ctx(),
    )

    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(seen?.aborted).toBe(true)
  })

  it('reports a warehouse error back to the model briefly', async () => {
    query.mockRejectedValue(
      new Error('Databricks statement FAILED: OVERLOADED'),
    )

    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toEqual({
      ok: false,
      reason: 'query_failed',
      detail: 'Databricks statement FAILED: OVERLOADED',
    })
  })

  it('stops the run rather than answering when the run itself is stopping', async () => {
    const stopping = new AbortController()
    query.mockImplementation(() => {
      stopping.abort()
      return Promise.reject(new Error('aborted'))
    })

    await expect(
      tool.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx({ signal: stopping.signal }),
      ),
    ).rejects.toThrow('aborted')
  })

  it('answers the same way twice', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })
    const sql = `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`

    const first = await runs(sql)
    const second = await runs(sql)

    expect(second).toEqual(first)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('refuses every query when the org has no jurisdiction', async () => {
    const unscoped = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => null,
    })

    await expect(
      unscoped.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx(),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'no_scope' })
    expect(query).not.toHaveBeenCalled()
  })
})

describe('orgDatabricksScope', () => {
  it("reads the run's organization jurisdiction, not tool input", async () => {
    const elections = service.app.get(ElectionsService)
    const district = vi.spyOn(elections, 'getDistrict').mockResolvedValue({
      id: 'district-1',
      state: 'NC',
      L2DistrictType: 'City_Ward',
      L2DistrictName: 'FAYETTEVILLE CITY WARD 2',
    })
    await service.prisma.organization.create({
      data: {
        slug: 'eo-dbx-scope',
        ownerId: service.user.id,
        customPositionName: 'City Council Member',
        overrideDistrictId: 'district-1',
      },
    })

    try {
      await expect(
        orgDatabricksScope(
          ctx({
            organizationSlug: 'eo-dbx-scope',
            // Nothing the model could have supplied is consulted.
            runId: 'run-1',
          }),
        ),
      ).resolves.toEqual({
        state: 'NC',
        district: {
          column: 'City_Ward',
          value: 'FAYETTEVILLE CITY WARD 2',
        },
      })
    } finally {
      district.mockRestore()
    }
  })

  it('resolves to null for an org with no jurisdiction', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-dbx-none', ownerId: service.user.id },
    })

    await expect(
      orgDatabricksScope(ctx({ organizationSlug: 'eo-dbx-none' })),
    ).resolves.toBeNull()
  })
})

describe('queryDatabricks on a run', () => {
  const OutputSchema = z.object({ summary: z.string() })
  const testTool = databricksTool({
    tables: [TABLE],
    maxRows: 2,
    scope: async () => SCOPE,
  })

  beforeAll(() => {
    AGENTS.databricksToolAgent = defineAgent({
      input: z.object({ organizationSlug: z.string() }),
      output: OutputSchema,
      model: 'claude-sonnet-4-6',
      prompt: 'Query the data.',
      tools: { queryDatabricks: testTool },
      onArtifact: async () => undefined,
    })
  })

  afterAll(() => {
    delete AGENTS.databricksToolAgent
  })

  it('hands the model a rejection, then the rows, and saves both as tool results', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(3) })
    const replied = (options: LanguageModelV3CallOptions) => {
      const step = options.prompt.filter((m) => m.role === 'assistant').length
      if (step === 0) {
        return {
          type: 'tool-call' as const,
          toolCallId: 'call-bad',
          toolName: 'queryDatabricks',
          input: JSON.stringify({
            sql: `SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters`,
          }),
        }
      }
      if (step === 1) {
        return {
          type: 'tool-call' as const,
          toolCallId: 'call-good',
          toolName: 'queryDatabricks',
          input: JSON.stringify({
            sql: `SELECT title, COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
          }),
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: 'call-submit',
        toolName: 'submitOutput',
        input: JSON.stringify({ output: { summary: 'done' } }),
      }
    }
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model: new MockLanguageModelV3({
        doStream: async (options) => ({
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'stream-start', warnings: [] },
              replied(options),
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                usage: {
                  inputTokens: {
                    total: 1000,
                    noCache: 1000,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 100, text: 100, reasoning: undefined },
                },
              },
            ],
          }),
        }),
      }),
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })
    await service.prisma.organization.create({
      data: { slug: 'eo-dbx-run', ownerId: service.user.id },
    })

    const { runId } = await service.app
      .get(AgentsService)
      .run('databricksToolAgent', { organizationSlug: 'eo-dbx-run' })
    await service.jobs.settle()

    const toolRows = await service.prisma.agentMessage.findMany({
      where: { agentRunId: runId, role: AgentMessageRole.tool },
      orderBy: { index: 'asc' },
      select: { parts: true },
    })
    const results = toolRows.map((row) => row.parts)
    expect(results[0]).toEqual([
      expect.objectContaining({
        toolName: 'queryDatabricks',
        output: expect.objectContaining({
          type: 'json',
          value: expect.objectContaining({ ok: false, reason: 'rejected' }),
        }),
      }),
    ])
    expect(results[1]).toEqual([
      expect.objectContaining({
        toolName: 'queryDatabricks',
        output: expect.objectContaining({
          type: 'json',
          value: expect.objectContaining({
            ok: true,
            rowCount: 2,
            truncated: true,
          }),
        }),
      }),
    ])
  })
})
