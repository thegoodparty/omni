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
import { AgentRunStatus, RaceOpponentResearchStatus } from '@/generated/prisma'
import { RaceContextService } from '@/campaignStrategy/services/raceContext.service'
import { AgentWebService } from '@/agents/tools/agentWeb.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { useTestService } from '@/test-service'
import { SelfResearchInputSchema } from './selfResearch.schema'

const service = useTestService({ jobs: true })

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const START_PATH = '/v1/campaigns/mine/race-opponent/self-research'
const STATUS_PATH = `${START_PATH}/status`

const PAGE = 'https://www.fayobserver.com/story/news/2026/06/01/levy-vote/'
const PAGE_TEXT =
  '<html><head><title>Council approves levy</title></head><body>' +
  '<p>Council member Test Candidate voted yes on the 2021 levy.</p>' +
  '</body></html>'

let orgSlug: string
const spies: { mockRestore: () => void }[] = []

const toolCall = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: `call-${uuidv7()}`,
  toolName,
  input: JSON.stringify(input),
})

const finding = {
  claim: 'Voted yes on the 2021 levy',
  source_url: PAGE,
  source_extract: 'Test Candidate voted yes on the 2021 levy.',
  category: 'record',
  drafted_response: 'The 2021 levy funded the schools, and I stand by it.',
}

// Fetch one source, then submit a finding grounded in it. The steps are picked
// by how many assistant turns the prompt already carries.
const scriptedModel = () => {
  const prompts: string[] = []
  const reply = (options: LanguageModelV3CallOptions) => {
    prompts.push(JSON.stringify(options.prompt))
    const step = options.prompt.filter((m) => m.role === 'assistant').length
    if (step === 0) return toolCall('fetchPage', { url: PAGE })
    return toolCall('submitOutput', { output: { findings: [finding] } })
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

// The one campaign the front door reads: Pro, with a race id so start() can
// resolve the state and office the agent's input requires.
const seedCampaign = async (isPro = true) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${orgSlug}-campaign`,
      organizationSlug: orgSlug,
      isPro,
      details: { raceId: 'race-1', city: 'Fayetteville' },
    },
  })
}

const stubRaceContext = () =>
  spies.push(
    vi
      .spyOn(service.app.get(RaceContextService), 'getRaceContext')
      .mockResolvedValue({
        state: 'NC',
        officialOfficeName: 'Fayetteville City Council',
        candidateOffice: 'City Council',
      } as never),
  )

// The persist's reachability gate is a real network call; the parse, the drop
// and the transaction still run.
const stubReachability = () =>
  spies.push(
    vi
      .spyOn(
        service.app.get(RaceOpponentResearchPersistService) as unknown as {
          checkReachable(url: string): Promise<Date | null>
        },
        'checkReachable',
      )
      .mockResolvedValue(new Date()),
  )

const start = () =>
  service.client.post(
    START_PATH,
    {},
    { headers: { [ORG_SLUG_HEADER]: orgSlug } },
  )

beforeEach(() => {
  orgSlug = `sr-${uuidv7()}`
})

afterEach(() => {
  vi.unstubAllEnvs()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('self_research on gp-api agents', () => {
  it('runs on gp-api when switched on, persists the findings and completes the pass', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'self_research')
    await seedCampaign()
    stubRaceContext()
    stubReachability()
    spies.push(
      vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue(undefined),
      vi.spyOn(service.app.get(AgentWebService), 'request').mockResolvedValue({
        status: 200,
        contentType: 'text/html',
        body: Buffer.from(PAGE_TEXT),
      }),
    )
    const prompts = scriptedModel()

    const res = await start()
    await service.jobs.settle()

    expect(res.status).toBe(HttpStatus.CREATED)

    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'self_research' },
    })
    expect(run.status).toBe(AgentRunStatus.completed)
    expect(run.input).toMatchObject({
      organizationSlug: orgSlug,
      fullName: 'Johnny Goodparty',
      state: 'NC',
      city: 'Fayetteville',
      officeName: 'Fayetteville City Council',
    })
    // The model is handed the manifest's field names in gp-api's casing, and
    // the page it read is in the conversation before it submits.
    expect(prompts[0]).toContain('fullName')
    expect(prompts[1]).toContain('voted yes on the 2021 levy')

    const research = await service.prisma.raceOpponentResearch.findFirstOrThrow(
      {
        where: { campaign: { organizationSlug: orgSlug } },
        include: { findings: true },
      },
    )
    expect(research.status).toBe(RaceOpponentResearchStatus.completed)
    expect(research.runId).toBe(run.id)
    expect(research.completedAt).not.toBeNull()
    expect(research.findings).toHaveLength(1)
    expect(research.findings[0]).toMatchObject({
      claim: finding.claim,
      sourceUrl: PAGE,
      draftedResponse: finding.drafted_response,
    })

    const status = await service.client.get(STATUS_PATH, {
      headers: { [ORG_SLUG_HEADER]: orgSlug },
    })
    expect(status.data.status).toBe(RaceOpponentResearchStatus.completed)

    // onArtifact can run twice for one run; the second writes nothing.
    await AGENTS.self_research?.onArtifact(
      { findings: [finding] },
      { runId: run.id, input: SelfResearchInputSchema.parse(run.input) },
      { get: (type) => service.app.get(type, { strict: false }) },
    )
    expect(
      await service.prisma.raceOpponentFinding.count({
        where: { research: { campaign: { organizationSlug: orgSlug } } },
      }),
    ).toBe(1)
  })

  it('starts no run for an organization in test mode', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'self_research')
    await seedCampaign()
    stubRaceContext()
    spies.push(
      vi.spyOn(service.app.get(AgentWebService), 'request'),
      vi.spyOn(service.app.get(ExperimentRunsService), 'dispatchRun'),
    )
    await service.prisma.organization.update({
      where: { slug: orgSlug },
      data: { testModeCreatedAt: new Date() },
    })

    const res = await start()

    // Dispatch declines, which the route reports as "not available here"
    // rather than claiming a run that will never start.
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.agentRun.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(0)
    const research = await service.prisma.raceOpponentResearch.findFirstOrThrow(
      {
        where: { campaign: { organizationSlug: orgSlug } },
      },
    )
    expect(research.status).toBe(RaceOpponentResearchStatus.failed)
  })

  it('reads a failed run as a failed pass, so the candidate can retry', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'self_research')
    await seedCampaign()
    stubRaceContext()
    spies.push(vi.spyOn(service.app.get(ExperimentRunsService), 'dispatchRun'))
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'self_research',
        organizationSlug: orgSlug,
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'a-shape',
        input: {},
      },
    })
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.raceOpponentResearch.create({
      data: {
        campaignId: campaign.id,
        kind: 'self',
        status: RaceOpponentResearchStatus.queued,
        runId: run.id,
      },
    })

    const status = await service.client.get(STATUS_PATH, {
      headers: { [ORG_SLUG_HEADER]: orgSlug },
    })

    expect(status.data.status).toBe(RaceOpponentResearchStatus.failed)
  })

  // A rollback moves the NEXT dispatch back to the PMF Engine; the run already
  // bound to the row is still gp-api's, and nothing else settles it.
  it('settles a run the row is bound to with the switch off', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', '')
    await seedCampaign()
    stubRaceContext()
    spies.push(vi.spyOn(service.app.get(ExperimentRunsService), 'dispatchRun'))
    const run = await service.prisma.agentRun.create({
      data: {
        agentName: 'self_research',
        organizationSlug: orgSlug,
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'a-shape',
        input: {},
      },
    })
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.raceOpponentResearch.create({
      data: {
        campaignId: campaign.id,
        kind: 'self',
        status: RaceOpponentResearchStatus.running,
        runId: run.id,
      },
    })

    const status = await service.client.get(STATUS_PATH, {
      headers: { [ORG_SLUG_HEADER]: orgSlug },
    })

    expect(status.data.status).toBe(RaceOpponentResearchStatus.failed)
  })

  // A shape change supersedes the run and starts its replacement. Reading the
  // superseded run as failed would show a failure while the replacement works,
  // and a retry would spend a run the replacement then overwrote.
  it('follows a superseded run to its replacement instead of failing', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'self_research')
    await seedCampaign()
    stubRaceContext()
    spies.push(vi.spyOn(service.app.get(ExperimentRunsService), 'dispatchRun'))
    const superseded = await service.prisma.agentRun.create({
      data: {
        agentName: 'self_research',
        organizationSlug: orgSlug,
        status: AgentRunStatus.superseded,
        manifest: {},
        shapeHash: 'old-shape',
        input: {},
      },
    })
    const replacement = await service.prisma.agentRun.create({
      data: {
        agentName: 'self_research',
        organizationSlug: orgSlug,
        status: AgentRunStatus.running,
        manifest: {},
        shapeHash: 'new-shape',
        input: {},
      },
    })
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.raceOpponentResearch.create({
      data: {
        campaignId: campaign.id,
        kind: 'self',
        status: RaceOpponentResearchStatus.running,
        runId: superseded.id,
      },
    })

    const status = await service.client.get(STATUS_PATH, {
      headers: { [ORG_SLUG_HEADER]: orgSlug },
    })

    expect(status.data.status).toBe(RaceOpponentResearchStatus.running)
    expect(status.data.research.runId).toBe(replacement.id)
  })

  // The campaign-details column holds '' for a field the candidate skipped, and
  // the agent's input treats a hint as a URL or a place name to try: '' would
  // reach the model as both, and fails the input schema besides.
  it('drops empty hint strings from the agent input', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'self_research')
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${orgSlug}-campaign`,
        organizationSlug: orgSlug,
        isPro: true,
        details: { raceId: 'race-1', city: '', website: '' },
      },
    })
    stubRaceContext()
    stubReachability()
    spies.push(
      vi.spyOn(service.app.get(AgentWebService), 'request').mockResolvedValue({
        status: 200,
        contentType: 'text/html',
        body: Buffer.from(PAGE_TEXT),
      }),
      vi.spyOn(service.app.get(ExperimentRunsService), 'dispatchRun'),
    )
    scriptedModel()

    const res = await start()
    await service.jobs.settle()

    expect(res.status).toBe(HttpStatus.CREATED)
    const run = await service.prisma.agentRun.findFirstOrThrow({
      where: { organizationSlug: orgSlug, agentName: 'self_research' },
    })
    expect(run.input).toMatchObject({ city: null, websiteUrl: null })
  })
})
