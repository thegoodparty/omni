import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { HttpStatus, type Type } from '@nestjs/common'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { AgentRunStatus, ExperimentRunStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain and must not be the first app-graph module evaluated.
import { AnalyticsService } from '@/analytics/analytics.service'
import { StrategicLandscapeParamsService } from '../services/strategicLandscapeParams.service'
import { OpportunitiesAndChallengesInputSchema } from './opportunitiesAndChallenges.schema'

const service = useTestService({ jobs: true })

const GENERATE = '/v1/campaignStrategy/mine/strategic-landscape'

const RACE_ID = 'br-oc-race'

// The params a dispatched run is built from: the contract's snake_case shape,
// exactly as StrategicLandscapeParamsService.build produces it. The suite only
// cares that the numbers reach the run, so every optional field is present and
// plain.
const PARAMS = {
  race_id: RACE_ID,
  user_email: 'tests@goodparty.org',
  user_first_name: 'Johnny',
  user_last_name: 'Goodparty',
  user_full_name: 'Johnny Goodparty',
  user_party_affiliation: 'nonpartisan',
  other_party: null,
  campaign_strategy_context: {
    candidate_count: 2,
    candidate_office: 'Rockvale City Council - District 3',
    candidates: [],
    contacts_needed_estimate: 13090,
    filing_date_end: null,
    general_election_date: '2099-11-03',
    number_of_seats: 1,
    office_level: 'Local',
    office_type: 'City Council',
    official_office_name: 'Rockvale City Council - District 3',
    partisan_type: 'nonpartisan',
    primary_election_date: null,
    projected_turnout: 5234,
    registered_voters: 8394,
    relevant_election_date: '2099-11-03',
    state: 'ME',
    unique_cellphones: 6157,
    unique_landlines: 1307,
    win_number_effective: 2618,
  },
  campaign_primary_strategy_context: null,
  campaign_story: {
    why: 'The bus route was cut.',
    background: 'Ten years running a small business.',
    issues: 'Transit.',
  },
}

const OUTPUT = {
  opportunities: [
    'You need 2,618 votes to win, 50% + 1 of the 5,234 projected voter turnout (GoodParty.org Data).',
    'Your targeted voter contact goal is 13,090, 5 times the projected votes needed to win (GoodParty.org Data).',
  ],
  challenges: [
    'Roughly 62% of the 8,394 registered voters in the district would have to be reached to hit your 13,090-contact goal (GoodParty.org Data).',
  ],
}

let orgSlug: string
let campaignId: number
// Restored one by one: restoreAllMocks would also undo the test service's own
// session-token mock.
const spies: { mockRestore: () => void }[] = []

const toolCall = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(input),
})

// One step: submit the artifact. Nothing here needs the web, so the run does
// not touch it and the test pays no network call.
const scriptedModel = () => {
  const prompts: string[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options: LanguageModelV3CallOptions) => {
      prompts.push(JSON.stringify(options.prompt))
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            toolCall('submitOutput', { output: OUTPUT }),
            {
              type: 'finish' as const,
              finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
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
      }
    },
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

const plan = () =>
  service.prisma.campaignStrategy.findUniqueOrThrow({ where: { campaignId } })

beforeEach(async () => {
  orgSlug = `campaign-oc-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: orgSlug,
      organizationSlug: orgSlug,
      details: { raceId: RACE_ID },
    },
  })
  campaignId = campaign.id
  spies.push(
    vi
      .spyOn(service.app.get(StrategicLandscapeParamsService), 'build')
      .mockResolvedValue(PARAMS as never),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('opportunities_and_challenges on gp-api agents', () => {
  it('runs on gp-api when switched on and writes both lists the plan reads', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opportunities_and_challenges')
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(pmfDispatch)
    const prompts = scriptedModel()

    const res = await service.client.post(GENERATE, undefined, {
      headers: { 'x-organization-slug': orgSlug },
    })
    expect(res.status).toBe(HttpStatus.ACCEPTED)
    await service.jobs.settle()

    // The PMF Engine is never asked for this section.
    expect(pmfDispatch.mock.calls.map((call) => call[0].type)).not.toContain(
      'opportunities_and_challenges',
    )

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    expect(run.agentName).toBe('opportunities_and_challenges')
    expect(run.status).toBe(AgentRunStatus.completed)
    // The run's input is the agent's camelCase shape, with the run's own date
    // rather than the manifest's.
    expect(
      OpportunitiesAndChallengesInputSchema.parse(run.input),
    ).toMatchObject({
      organizationSlug: orgSlug,
      raceId: RACE_ID,
      userEmail: 'tests@goodparty.org',
      campaignStrategyContext: {
        state: 'ME',
        winNumberEffective: 2618,
        projectedTurnout: 5234,
      },
    })
    // The prompt carries the race numbers, not the manifest's field names.
    expect(prompts[0]).toContain('winNumberEffective')
    expect(prompts[0]).not.toContain('win_number_effective')

    // onArtifact wrote both lists, in order, and stamped the plan.
    const persisted = await plan()
    expect(persisted.opportunitiesRunId).toBe(run.id)
    expect(persisted.opportunitiesPersistedAt).not.toBeNull()
    const opportunities =
      await service.prisma.campaignStrategyOpportunity.findMany({
        where: { campaignStrategyId: persisted.id },
        orderBy: { order: 'asc' },
      })
    const challenges = await service.prisma.campaignStrategyChallenge.findMany({
      where: { campaignStrategyId: persisted.id },
      orderBy: { order: 'asc' },
    })
    expect(opportunities.map((o) => o.content)).toEqual(OUTPUT.opportunities)
    expect(challenges.map((c) => c.content)).toEqual(OUTPUT.challenges)
  })

  it('fires the completion event with the gp-api engine name', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opportunities_and_challenges')
    spies.push(
      vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue(undefined),
    )
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({} as never)
    spies.push(track)
    scriptedModel()

    await service.client.post(GENERATE, undefined, {
      headers: { 'x-organization-slug': orgSlug },
    })
    await service.jobs.settle()

    const completed = track.mock.calls.find(
      (call) =>
        call[1] ===
        'Campaign Plan V2 - Opportunities & Challenges Generation Completed',
    )
    expect(completed?.[2]).toMatchObject({
      campaignId,
      generationEngine: 'gp-api',
      outcome: 'COMPLETED',
    })
  })

  it('a second onArtifact for the same run writes nothing new', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opportunities_and_challenges')
    spies.push(
      vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue(undefined),
    )
    scriptedModel()

    await service.client.post(GENERATE, undefined, {
      headers: { 'x-organization-slug': orgSlug },
    })
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    const persisted = await plan()
    const rows = () =>
      service.prisma.campaignStrategyOpportunity.findMany({
        where: { campaignStrategyId: persisted.id },
        orderBy: { order: 'asc' },
        select: { id: true, content: true },
      })
    const before = await rows()

    await AGENTS.opportunities_and_challenges?.onArtifact(
      OUTPUT,
      {
        runId: run.id,
        input: OpportunitiesAndChallengesInputSchema.parse(run.input),
      },
      {
        get: <S>(type: Type<S>) => service.app.get(type, { strict: false }),
      },
    )

    expect(await rows()).toEqual(before)
    expect((await plan()).opportunitiesPersistedAt).toEqual(
      persisted.opportunitiesPersistedAt,
    )
  })

  it('leaves the section to the PMF Engine when the switch is off', async () => {
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockImplementation(async ({ type, organizationSlug }) =>
        service.prisma.experimentRun.create({
          data: {
            organizationSlug,
            experimentType: type,
            status: ExperimentRunStatus.RUNNING,
          },
        }),
      )
    spies.push(pmfDispatch)

    await service.client.post(GENERATE, undefined, {
      headers: { 'x-organization-slug': orgSlug },
    })
    await service.jobs.settle()

    expect(pmfDispatch.mock.calls.map((call) => call[0].type)).toContain(
      'opportunities_and_challenges',
    )
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
  })

  it('starts no agent run for an organization in test mode', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opportunities_and_challenges')
    // The campaign's user is real, so this is not the product's test-campaign
    // short circuit above it: it is the guard the PMF Engine's dispatchRun
    // makes for a test-mode org, which AgentsService.run does not.
    await service.prisma.organization.update({
      where: { slug: orgSlug },
      data: { testModeCreatedAt: new Date() },
    })
    const pmfDispatch = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    spies.push(pmfDispatch)

    const res = await service.client.post(GENERATE, undefined, {
      headers: { 'x-organization-slug': orgSlug },
    })

    expect(res.data).toEqual({ status: 'failed', reason: 'queue_failed' })
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
    // The opposition section is still the PMF Engine's and still dispatched;
    // only this section is refused.
    expect(pmfDispatch.mock.calls.map((call) => call[0].type)).toEqual([
      'opposition_research',
    ])
  })
})
