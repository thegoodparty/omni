import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { HttpStatus } from '@nestjs/common'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { orgDatabricksScope } from '@/agents/tools/queryDatabricks'
import type { ToolContext } from '@/agents/tools/tool'
import { AgentWebService } from '@/agents/tools/agentWeb.service'
import {
  AgentRunStatus,
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  DashboardCardType,
  Prisma,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain and must not be the first app-graph module evaluated.
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  TOP_COMMUNITY_ISSUES_TABLE,
  topCommunityIssuesDatabricksScope,
} from './topCommunityIssues.agent'
import { TopCommunityIssuesInputSchema } from './topCommunityIssues.schema'

const service = useTestService({ jobs: true })

const BASE = '/v1/community-issues'

const SERVE_CONTEXT = {
  state: 'NC',
  positionName: 'City Council Member',
  l2DistrictType: 'City_Ward',
  l2DistrictName: 'FAYETTEVILLE CITY WARD 2',
}

const LEAN_SQL = `SELECT COUNT(*) AS n, ROUND(AVG(hs_violent_crime_worried), 1) AS avg_hs_violent_crime_worried FROM ${TOP_COMMUNITY_ISSUES_TABLE} WHERE Residence_Addresses_State = 'NC' AND City_Ward = 'FAYETTEVILLE CITY WARD 2' AND Voters_Active = 'A'`

let orgSlug: string
let officeId: string
let carriedId: string
let omittedId: string
const spies: { mockRestore: () => void }[] = []

const source = {
  id: 's1',
  name: 'Fayetteville Observer',
  source_type: 'news',
  url: 'https://www.fayobserver.com/story/news/2026/09/01/stormwater/',
  article_type: 'opinion',
  article_date: '2026-09-01',
  retrieved_at: '2026-11-15T10:00:00Z',
  retrieved_text_or_snapshot: 'Residents wrote in about flooding.',
}

const issue = (title: string, rank: number, existingId?: string) => ({
  ...(existingId && { existing_issue_id: existingId }),
  title,
  summary: `${title}, raised by residents.`,
  category: 'infrastructure_and_transportation',
  priority: 'medium',
  rank,
  detail: {
    sources: [source],
    overview: { summary: `${title} overview.`, source_ids: ['s1'] },
  },
})

const output = (issues: ReturnType<typeof issue>[]) => ({
  schema_version: 1,
  list: 'top_community',
  issues,
  sources_used: ['local_news', 'internal_voter_data'],
  data_quality: 'partial',
  data_quality_reason: 'No 311 feed found.',
})

const toolCall = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(input),
})

// Read the feed, run the lean query, submit with the feed's issue carried
// and the other one left out.
const scriptedModel = () => {
  const prompts: string[] = []
  const reply = (options: LanguageModelV3CallOptions) => {
    prompts.push(JSON.stringify(options.prompt))
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    if (step === 0)
      return toolCall('getCommunityIssues', { list: 'top_community' })
    if (step === 1) return toolCall('queryDatabricks', { sql: LEAN_SQL })
    return toolCall('submitOutput', {
      output: output([
        issue('Stormwater flooding on Murchison Road', 1, carriedId),
        issue('Road repaving backlog', 2),
      ]),
    })
  }
  const model = new MockLanguageModelV3({
    doStream: async (options) => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          reply(options),
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_use' },
            usage: {
              inputTokens: {
                total: 2000,
                noCache: 2000,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 200, text: 200, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  })
  spies.push(
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model,
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    }),
  )
  return prompts
}

const topRow = (title: string, rank: number) =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: orgSlug,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.infrastructure_and_transportation,
      priority: CommunityIssuePriority.high,
      title,
      summary: `${title}.`,
      detail: { overview: { summary: 'ok', source_ids: [] }, sources: [] },
      rank,
    },
  })

const toolContext = (runId: string): ToolContext => ({
  runId,
  stepKey: 'step-0',
  organizationSlug: orgSlug,
  signal: new AbortController().signal,
  get: (type) => service.app.get(type, { strict: false }),
})

const seedRun = (input: Prisma.InputJsonObject, organizationSlug = orgSlug) =>
  service.prisma.agentRun.create({
    data: {
      agentName: 'top_community_issues',
      organizationSlug,
      status: AgentRunStatus.running,
      manifest: {},
      shapeHash: 'a-shape',
      input,
    },
  })

beforeEach(async () => {
  orgSlug = `eo-top-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  const office = await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: orgSlug },
  })
  officeId = office.id
  // A starter row the official prioritized, and one the run leaves out.
  carriedId = (await topRow('Flooding on Murchison Road', 1)).id
  omittedId = (await topRow('Downtown parking', 2)).id
  await service.prisma.priority.create({
    data: {
      electedOfficeId: officeId,
      title: 'Flooding',
      description: 'From the community issues list',
      source: 'community_issue',
      sourceCommunityIssueId: carriedId,
    },
  })
  spies.push(
    vi
      .spyOn(service.app.get(OrganizationsService), 'resolveServeContext')
      .mockResolvedValue(SERVE_CONTEXT),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('top_community_issues on gp-api agents', () => {
  it('runs on gp-api when switched on, keeps the carried id and fires the ready email', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
    // The trending list has generated already, so this first top list
    // completes the pair and sends the "your issues are ready" event.
    await service.prisma.communityIssue.create({
      data: {
        organizationSlug: orgSlug,
        list: CommunityIssueList.trending,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.medium,
        title: 'Speeding on Raeford Road',
        summary: 'Residents report speeding.',
        detail: { overview: { summary: 'ok', source_ids: [] }, sources: [] },
        rank: 1,
        lastRefreshedRunId: 'an-earlier-run',
      },
    })
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    const query = vi
      .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
      .mockResolvedValue({
        columns: ['n', 'avg_hs_violent_crime_worried'],
        rows: [['31000', '58.2']],
      })
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })
    spies.push(
      pmfDispatch,
      query,
      track,
      vi.spyOn(service.app.get(AgentWebService), 'request').mockResolvedValue({
        status: 200,
        contentType: 'text/html',
        body: Buffer.from(''),
      }),
    )
    const prompts = scriptedModel()

    const res = await service.client.post<{ dispatched: number }>(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.dispatched).toBe(1)
    await service.jobs.settle()

    expect(pmfDispatch).not.toHaveBeenCalled()
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'top_community_issues' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(run.input).toMatchObject({
      organizationSlug: orgSlug,
      state: 'NC',
      office: 'City Council Member',
      districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
      l2DistrictType: 'City_Ward',
      l2DistrictName: 'FAYETTEVILLE CITY WARD 2',
    })
    expect(prompts[1]).toContain(carriedId)
    expect(query.mock.calls.map((call) => call[0].sql)).toEqual([LEAN_SQL])

    const rows = await service.prisma.communityIssue.findMany({
      where: {
        organizationSlug: orgSlug,
        list: CommunityIssueList.top_community,
      },
      orderBy: { createdAt: 'asc' },
    })
    expect(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        run: row.lastRefreshedRunId,
        archived: row.archivedAt !== null,
      })),
    ).toEqual([
      {
        id: carriedId,
        title: 'Stormwater flooding on Murchison Road',
        run: run.id,
        archived: false,
      },
      {
        id: omittedId,
        title: 'Downtown parking',
        run: null,
        archived: true,
      },
      {
        id: expect.any(String),
        title: 'Road repaving backlog',
        run: run.id,
        archived: false,
      },
    ])
    // The priority the official made from the carried issue stays on it.
    const priority = await service.prisma.priority.findFirstOrThrow({
      where: { electedOfficeId: officeId },
    })
    expect(priority.sourceCommunityIssueId).toBe(carriedId)

    expect(track.mock.calls.map((call) => call[1])).toEqual([
      EVENTS.CommunityIssues.InitialIssuesGenerated,
    ])
    expect(track.mock.calls[0]?.[2]).toMatchObject({
      topIssueCount: 2,
      trendingIssueCount: 1,
      topIssue1Title: 'Stormwater flooding on Murchison Road',
      trendingIssue1Title: 'Speeding on Raeford Road',
    })

    // onArtifact can run twice for one run; the second writes and sends
    // nothing.
    await AGENTS.top_community_issues?.onArtifact(
      output([issue('Something else entirely', 1)]),
      {
        runId: run.id,
        input: TopCommunityIssuesInputSchema.parse(run.input),
      },
      { get: (type) => service.app.get(type, { strict: false }) },
    )
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: orgSlug, archivedAt: null },
      }),
    ).toBe(3)
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('refuses an output the run read no data for, and takes one a query backs', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })
    const query = vi
      .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
      .mockResolvedValue({ columns: ['n'], rows: [['31000']] })
    spies.push(track, query)
    // Submit with no query run first, then run it, then the same submit. The
    // first is the fabricated list the PMF Engine's broker refuses to publish.
    const replies = [
      toolCall('getCommunityIssues', { list: 'top_community' }),
      toolCall('submitOutput', {
        output: output([issue('Stormwater flooding on Murchison Road', 1)]),
      }),
      toolCall('queryDatabricks', { sql: LEAN_SQL }),
      toolCall('submitOutput', {
        output: output([issue('Stormwater flooding on Murchison Road', 1)]),
      }),
    ]
    const prompts: string[] = []
    spies.push(
      vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
        model: new MockLanguageModelV3({
          doStream: async (options) => {
            prompts.push(JSON.stringify(options.prompt))
            return {
              stream: simulateReadableStream<LanguageModelV3StreamPart>({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  replies[prompts.length - 1]!,
                  {
                    type: 'finish',
                    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                    usage: {
                      inputTokens: {
                        total: 2000,
                        noCache: 2000,
                        cacheRead: 0,
                        cacheWrite: 0,
                      },
                      outputTokens: {
                        total: 200,
                        text: 200,
                        reasoning: undefined,
                      },
                    },
                  },
                ],
              }),
            }
          },
        }),
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
      }),
    )

    await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'top_community_issues' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    // The refusal reached the model, which is what sent it to the query.
    expect(prompts[2]).toContain('No warehouse query succeeded')
    expect(query).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: orgSlug, lastRefreshedRunId: run.id },
      }),
    ).toBe(1)
  })

  it('accepts insufficient_signal with no query at all, as the manifest allows', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
    spies.push(
      vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue({ event: 'stub', userId: 'stub' }),
      vi
        .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
        .mockResolvedValue({ columns: [], rows: [] }),
    )
    const prompts: string[] = []
    spies.push(
      vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
        model: new MockLanguageModelV3({
          doStream: async (options) => {
            prompts.push(JSON.stringify(options.prompt))
            return {
              stream: simulateReadableStream<LanguageModelV3StreamPart>({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-call',
                    toolCallId: `call-${uuidv7()}`,
                    toolName: 'submitOutput',
                    input: JSON.stringify({
                      output: {
                        ...output([]),
                        data_quality: 'insufficient_signal',
                        data_quality_reason: 'No such office in this state.',
                      },
                    }),
                  },
                  {
                    type: 'finish',
                    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                    usage: {
                      inputTokens: {
                        total: 2000,
                        noCache: 2000,
                        cacheRead: 0,
                        cacheWrite: 0,
                      },
                      outputTokens: {
                        total: 200,
                        text: 200,
                        reasoning: undefined,
                      },
                    },
                  },
                ],
              }),
            }
          },
        }),
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
      }),
    )

    await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'top_community_issues' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('No warehouse query succeeded')
  })

  it('a refresh makes a task card for each new issue and sends Top Issues Refreshed', async () => {
    await service.prisma.communityIssue.updateMany({
      where: { organizationSlug: orgSlug },
      data: { lastRefreshedRunId: 'an-earlier-run' },
    })
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })
    spies.push(track)
    const run = await seedRun({
      organizationSlug: orgSlug,
      state: 'NC',
      office: 'City Council Member',
      districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
      today: '2026-11-18',
    })

    await AGENTS.top_community_issues?.onArtifact(
      output([
        issue('Stormwater flooding on Murchison Road', 1, carriedId),
        issue('Road repaving backlog', 2),
      ]),
      {
        runId: run.id,
        input: TopCommunityIssuesInputSchema.parse(run.input),
      },
      { get: (type) => service.app.get(type, { strict: false }) },
    )

    const created = await service.prisma.communityIssue.findFirstOrThrow({
      where: { organizationSlug: orgSlug, title: 'Road repaving backlog' },
    })
    const cards = await service.prisma.dashboardCard.findMany({
      where: {
        electedOfficeId: officeId,
        type: DashboardCardType.community_issue,
      },
    })
    expect(cards.map((card) => card.sourceExternalId)).toEqual([created.id])
    expect(track.mock.calls.map((call) => call[1])).toEqual([
      EVENTS.CommunityIssues.TopIssuesRefreshed,
    ])
  })

  it('starts no run for an organization in test mode', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
    await service.prisma.organization.update({
      where: { slug: orgSlug },
      data: { testModeCreatedAt: new Date() },
    })

    await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )

    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })

  it('dispatches to the PMF Engine when the switch is off', async () => {
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(pmfDispatch)

    const res = await service.client.post<{ dispatched: number }>(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    expect(res.data).toEqual({ dispatched: 1, skipped: 0 })
    expect(pmfDispatch.mock.calls.map((call) => call[0].type)).toEqual([
      'top_community_issues',
    ])
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })
})

describe('topCommunityIssuesDatabricksScope', () => {
  it('matches orgDatabricksScope for a run the dispatcher started', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
    spies.push(
      vi
        .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
        .mockResolvedValue({ columns: [], rows: [] }),
    )
    scriptedModel()

    await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    await service.jobs.settle()
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'top_community_issues' },
    })

    const fromRun = await topCommunityIssuesDatabricksScope(toolContext(run.id))
    expect(fromRun).toEqual({
      state: 'NC',
      district: { column: 'City_Ward', value: 'FAYETTEVILLE CITY WARD 2' },
    })
    expect(fromRun).toEqual(await orgDatabricksScope(toolContext(run.id)))
  })

  it('scopes to the state when the run has no L2 pair', async () => {
    const run = await seedRun({
      organizationSlug: orgSlug,
      state: 'TX',
      office: 'County Commissioner',
      districtDescriptor: 'Kenedy County Commissioner, Precinct 2, TX',
      today: '2026-11-18',
    })

    expect(
      await topCommunityIssuesDatabricksScope(toolContext(run.id)),
    ).toEqual({ state: 'TX', district: null })
  })

  it.each([
    [
      'half an L2 pair',
      {
        state: 'NC',
        office: 'City Council Member',
        districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
        l2DistrictType: 'City_Ward',
        today: '2026-11-18',
      },
    ],
    [
      'no state',
      {
        office: 'City Council Member',
        districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
        today: '2026-11-18',
      },
    ],
    [
      'an empty state',
      {
        state: '',
        office: 'City Council Member',
        districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
        today: '2026-11-18',
      },
    ],
  ])('refuses every query for a run with %s', async (_name, input) => {
    const run = await seedRun({ organizationSlug: orgSlug, ...input })

    expect(await topCommunityIssuesDatabricksScope(toolContext(run.id))).toBe(
      null,
    )
  })

  it("refuses a run id that is not the calling organization's", async () => {
    const otherSlug = `eo-top-other-${uuidv7()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const run = await seedRun(
      {
        organizationSlug: otherSlug,
        state: 'NC',
        office: 'City Council Member',
        districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
        today: '2026-11-18',
      },
      otherSlug,
    )

    expect(await topCommunityIssuesDatabricksScope(toolContext(run.id))).toBe(
      null,
    )
  })
})
