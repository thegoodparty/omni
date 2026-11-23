import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { HttpStatus } from '@nestjs/common'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CampaignTrackerTasksService } from '@/campaigns/campaignTracker/services/campaignTrackerTasks.service'
import { AgentRunStatus, CampaignStrategy } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OppositionResearchInputSchema } from './oppositionResearch.schema'

const service = useTestService({ jobs: true })

const ORG_SLUG_HEADER = 'x-organization-slug'
const RACE_ID = 'br-opposition-race'

const spies: { mockRestore: () => void }[] = []

const candidate = (email: string | null) => ({
  first_name: 'Test',
  last_name: 'Candidate',
  full_name: 'Test Candidate',
  email,
  website_url: null,
  party: null,
  is_incumbent: false,
})

const rival = {
  first_name: 'Marlowe',
  last_name: 'Quennell',
  full_name: 'Marlowe Quennell',
  email: null,
  website_url: null,
  party: 'Nonpartisan',
  is_incumbent: true,
}

// The manifest's snake_case shape, which is what the run route accepts on both
// engines and what a judge suite writes.
const input = (
  userEmail: string,
  candidates = [candidate(userEmail), rival],
) => ({
  race_id: RACE_ID,
  user_email: userEmail,
  user_full_name: 'Test Candidate',
  user_first_name: 'Test',
  user_last_name: 'Candidate',
  user_party_affiliation: null,
  other_party: null,
  campaign_strategy_context: {
    candidate_count: candidates.length,
    candidate_office: 'Cheyenne City Council - Ward 1',
    candidates,
    number_of_seats: 1,
    partisan_type: 'nonpartisan',
    state: 'WY',
    relevant_election_date: '2026-11-03',
  },
  campaign_primary_strategy_context: null,
})

const toolCall = (toolName: string, toolInput: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(toolInput),
})

// Submit straight away: this file tests the write path and the harness, not the
// prompt, which the judge suite covers.
const submittingModel = () => {
  const model = new MockLanguageModelV3({
    doStream: async (_options: LanguageModelV3CallOptions) => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          toolCall('submitOutput', {
            output: {
              opponents: [
                {
                  full_name: rival.full_name,
                  party_affiliation: 'Nonpartisan',
                  incumbent: true,
                },
              ],
            },
          }),
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
  return model
}

const seedCampaignWithPlan = async () => {
  await service.prisma.organization.create({
    data: { slug: `opp-${uuidv7()}`, ownerId: service.user.id },
  })
  const organization = await service.prisma.organization.findFirstOrThrow({
    where: { ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `opp-campaign-${uuidv7()}`,
      organizationSlug: organization.slug,
      isPro: true,
      details: { raceId: RACE_ID },
    },
  })
  const plan = await service.prisma.campaignStrategy.create({
    data: { campaignId: campaign.id, raceId: RACE_ID },
  })
  return { organization, campaign, plan }
}

const linkPlanToRun = (plan: CampaignStrategy, runId: string) =>
  service.prisma.campaignStrategy.update({
    where: { id: plan.id },
    data: { oppositionRunId: runId },
  })

const startRun = (caseInput: Record<string, unknown>, orgSlug: string) =>
  service.client.post<{ runId: string }>(
    '/v1/agents/opposition_research/runs',
    { input: { organization_slug: orgSlug, ...caseInput } },
    { headers: { [ORG_SLUG_HEADER]: orgSlug } },
  )

const readRun = (runId: string, orgSlug: string) =>
  service.client.get<{
    status: string
    artifact: unknown
    error: string | null
  }>(`/v1/agents/runs/${runId}`, { headers: { [ORG_SLUG_HEADER]: orgSlug } })

beforeEach(() => {
  vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
  spies.push(
    vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' }),
    vi
      .spyOn(
        service.app.get(CampaignTrackerTasksService),
        'bootstrapForCampaign',
      )
      .mockResolvedValue(),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('opposition_research on gp-api agents', () => {
  it('runs on gp-api when switched on, and persists the section on the plan its run is linked to', async () => {
    const { organization, campaign, plan } = await seedCampaignWithPlan()
    const { email } = service.user
    submittingModel()

    const res = await startRun(input(email), organization.slug)
    expect(res.status).toBe(HttpStatus.CREATED)
    const { runId } = res.data
    await linkPlanToRun(plan, runId)
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { id: runId },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    // The route converts the manifest's keys to gp-api's camelCase.
    expect(run.input).toMatchObject({
      organizationSlug: organization.slug,
      raceId: RACE_ID,
      userEmail: email,
      campaignStrategyContext: {
        candidateCount: 2,
        partisanType: 'nonpartisan',
      },
    })

    const persisted = await service.prisma.campaignStrategyOpponent.findMany({
      where: { campaignStrategyId: plan.id },
    })
    expect(persisted).toEqual([
      expect.objectContaining({
        fullName: 'Marlowe Quennell',
        partyAffiliation: 'Nonpartisan',
        incumbent: true,
      }),
    ])
    const read = await service.prisma.campaignStrategy.findFirstOrThrow({
      where: { id: plan.id },
    })
    expect(read.oppositionPersistedAt).not.toBeNull()
    expect(campaign.id).toBe(read.campaignId)

    expect(
      (
        (await service.app.get(AnalyticsService).track) as unknown as {
          mock: { calls: unknown[][] }
        }
      ).mock.calls.map((call) => call[1]),
    ).toContain(EVENTS.CampaignPlanV2.OppositionResearchGenerationCompleted)
  })

  it('hands the artifact back through the run route when no plan is linked', async () => {
    const { organization } = await seedCampaignWithPlan()
    submittingModel()

    const res = await startRun(input(service.user.email), organization.slug)
    await service.jobs.settle()

    const read = await readRun(res.data.runId, organization.slug)
    expect(read.status).toBe(HttpStatus.OK)
    expect(read.data.status).toBe('completed')
    expect(read.data.artifact).toEqual({
      opponents: [
        {
          full_name: 'Marlowe Quennell',
          party_affiliation: 'Nonpartisan',
          incumbent: true,
        },
      ],
    })
  })

  it('a second onArtifact for the same run writes nothing new', async () => {
    const { organization, plan } = await seedCampaignWithPlan()
    submittingModel()

    const res = await startRun(input(service.user.email), organization.slug)
    await linkPlanToRun(plan, res.data.runId)
    await service.jobs.settle()

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { id: res.data.runId },
    })
    const before = await service.prisma.campaignStrategyOpponent.count({
      where: { campaignStrategyId: plan.id },
    })

    await AGENTS.opposition_research?.onArtifact(
      {
        opponents: [
          {
            full_name: 'Late Filer',
            party_affiliation: 'Unknown',
            incumbent: null,
          },
        ],
      },
      { runId: run.id, input: OppositionResearchInputSchema.parse(run.input) },
      { get: (type) => service.app.get(type, { strict: false }) },
    )

    expect(
      await service.prisma.campaignStrategyOpponent.count({
        where: { campaignStrategyId: plan.id },
      }),
    ).toBe(before)
    expect(
      await service.prisma.campaignStrategyOpponent.findFirstOrThrow({
        where: { campaignStrategyId: plan.id },
      }),
    ).toEqual(expect.objectContaining({ fullName: 'Marlowe Quennell' }))
  })
})
