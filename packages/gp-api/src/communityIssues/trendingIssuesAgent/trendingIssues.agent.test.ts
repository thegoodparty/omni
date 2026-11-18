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
import { AgentWebService } from '@/agents/tools/agentWeb.service'
import {
  AgentRunStatus,
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { TrendingIssuesInputSchema } from './trendingIssues.schema'

const service = useTestService({ jobs: true })

const BASE = '/v1/community-issues'

let orgSlug: string
let carriedId: string
// Restored one by one: restoreAllMocks would also undo the test service's
// own session-token mock.
const spies: { mockRestore: () => void }[] = []

const source = {
  id: 's1',
  name: 'Fayetteville Observer',
  source_type: 'news',
  url: 'https://www.fayobserver.com/story/news/2026/11/01/stormwater/',
  article_type: 'reporting',
  article_date: '2026-11-01',
  retrieved_at: '2026-11-15T10:00:00Z',
  retrieved_text_or_snapshot: 'The council heard from residents on flooding.',
}

const issue = (title: string, rank: number, existingId?: string) => ({
  ...(existingId && { existing_issue_id: existingId }),
  title,
  summary: `${title}, covered in local news.`,
  category: 'infrastructure_and_transportation',
  priority: 'medium',
  rank,
  detail: {
    sources: [source],
    overview: { summary: `${title} overview.`, source_ids: ['s1'] },
  },
})

const OUTPUT = {
  schema_version: 1,
  list: 'trending',
  issues: [issue('Stormwater flooding', 1), issue('Road repaving', 2)],
  data_quality: 'partial',
  data_quality_reason: 'Two issues inside the window.',
}

const toolCall = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(input),
})

// The run's steps, picked by how many assistant turns are already in the
// prompt: read the feed, check a source, submit with the feed's issue
// carried.
const scriptedModel = () => {
  const prompts: string[] = []
  const reply = (options: LanguageModelV3CallOptions) => {
    prompts.push(JSON.stringify(options.prompt))
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    if (step === 0) return toolCall('getCommunityIssues', { list: 'trending' })
    if (step === 1) return toolCall('checkLink', { url: source.url })
    return toolCall('submitOutput', {
      output: {
        ...OUTPUT,
        issues: [
          issue('Stormwater flooding', 1, carriedId),
          issue('Road repaving', 2),
        ],
      },
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

beforeEach(async () => {
  orgSlug = `eo-trending-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: orgSlug },
  })
  const carried = await service.prisma.communityIssue.create({
    data: {
      organizationSlug: orgSlug,
      list: CommunityIssueList.trending,
      category: CommunityIssueCategory.infrastructure_and_transportation,
      priority: CommunityIssuePriority.high,
      title: 'Flooding on Murchison Road',
      summary: 'Residents report flooding.',
      detail: { overview: { summary: 'ok', source_ids: [] }, sources: [] },
      rank: 1,
    },
  })
  carriedId = carried.id
  spies.push(
    vi
      .spyOn(service.app.get(OrganizationsService), 'resolveServeContext')
      .mockResolvedValue({
        state: 'NC',
        positionName: 'City Council Member',
        l2DistrictName: 'FAYETTEVILLE CITY WARD 2',
      }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('trending_issues on gp-api agents', () => {
  it('runs on gp-api when switched on and writes the issues products read', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'trending_issues')
    const pmfDispatch = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )
    spies.push(
      pmfDispatch,
      vi.spyOn(service.app.get(AgentWebService), 'request').mockResolvedValue({
        status: 200,
        contentType: 'text/html',
        body: Buffer.from(''),
      }),
    )
    const prompts = scriptedModel()

    const res = await service.client.post<{ dispatched: number }>(
      `${BASE}/self-dispatch`,
      { type: 'trending_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.dispatched).toBe(1)
    await service.jobs.settle()

    expect(pmfDispatch).not.toHaveBeenCalled()
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'trending_issues' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(run.input).toMatchObject({
      organizationSlug: orgSlug,
      state: 'NC',
      office: 'City Council Member',
      districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
    })
    // The feed the model read carried the existing issue's id.
    expect(prompts[1]).toContain(carriedId)

    const issues = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: orgSlug, list: CommunityIssueList.trending },
      orderBy: { rank: 'asc' },
    })
    expect(
      issues.map((i) => ({
        id: i.id,
        title: i.title,
        run: i.lastRefreshedRunId,
        archived: i.archivedAt !== null,
      })),
    ).toEqual([
      {
        id: carriedId,
        title: 'Stormwater flooding',
        run: run.id,
        archived: false,
      },
      {
        id: expect.any(String),
        title: 'Road repaving',
        run: run.id,
        archived: false,
      },
    ])

    // onArtifact can run twice for one run; the second writes nothing.
    await AGENTS.trending_issues?.onArtifact(
      OUTPUT,
      { runId: run.id, input: TrendingIssuesInputSchema.parse(run.input) },
      { get: (type) => service.app.get(type, { strict: false }) },
    )
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(2)
  })

  it('starts no run for an organization in test mode', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'trending_issues')
    await service.prisma.organization.update({
      where: { slug: orgSlug },
      data: { testModeCreatedAt: new Date() },
    })

    await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'trending_issues' },
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
      { type: 'trending_issues' },
      { headers: { 'x-organization-slug': orgSlug } },
    )
    expect(res.data).toEqual({ dispatched: 1, skipped: 0 })
    expect(pmfDispatch.mock.calls.map((call) => call[0].type)).toEqual([
      'trending_issues',
    ])
    expect(
      await service.prisma.experimentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })
})
