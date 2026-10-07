import { describe, expect, it, vi } from 'vitest'
import {
  CreateChatResponseSchema,
  type ChatAnchor,
  type CreateChatResponse,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { ChiefOfStaffHandler } from '@/chats/general/chief-of-staff/chiefOfStaff.handler'
import { PriorityFlowHandler } from '@/chats/general/priority-flow/priorityFlow.handler'
import { CampaignManagerHandler } from '@/chats/general/campaign-manager/campaignManager.handler'
import { OrdinanceFlowHandler } from '@/chats/general/ordinance-flow/ordinanceFlow.handler'
import { InMemoryDatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { BriefingNotesService } from '@/chats/briefing-chats/services/briefingNotes.service'
import {
  createBriefingChatResponseSchema,
  type CreateBriefingChatResponse,
} from '@/chats/briefing-chats/schemas/CreateBriefingChat.schema'
import { installBriefingFixture } from './chatSeam'
import {
  JUDGE_BRIEFING_ARTIFACT,
  JUDGE_BRIEFING_BUCKET,
  JUDGE_BRIEFING_TODAY,
  JUDGE_MEETING_DATE,
  JUDGE_NOTE,
} from './briefingFixture'
import { ExperimentRunStatus } from '../../../../generated/prisma'
import { parseIsoDateAsUTC } from '@/shared/util/date.util'
import {
  chatScopeFor,
  JUDGE_POSITION,
  seedChatOrg,
  type SeedChatOrgOptions,
} from './seedChatOrg'

// WHAT THE SEEDER BUYS THE AGENT, asserted as tool names.
//
// A scope handler assembles its tool set from its context, so a row the seeder
// leaves out does not merely thin an answer — it takes a tool off the list the
// model is given, and the case then measures whether the agent is honest about
// a capability it was never granted. Three such rows were missing, and between
// them they cost the constituent-data pair on every Serve scope, the whole
// voter-file family on campaign_assistant, and five of the ordinance flow's
// seven steps.
//
// ASSERTED THROUGH buildTools, WHICH IS THE REGISTRY ITSELF — the same method
// the stream service calls to decide what the model may use, and the same one
// buildSystemPrompt reads to decide what to advertise. A test that checked
// `positionId !== null` would prove a column was written and nothing about
// whether a tool exists.
//
// Every handler here is the REAL one out of the container, with its real
// context service, real district resolver and real table allowlist, reading
// the real seeded rows over the real Postgres. Two dependencies are supplied
// that a test process does not have and a deployment does, and only those two:
// see `withJudgePosition` and `withConstituentProvider`.
const service = useTestService()

const CONSTITUENT_TOOLS = [
  'query_constituent_data',
  'describe_constituent_data',
]

// The four tools behind `ctx.isPro !== false` in campaignManager.handler.ts.
const VOTER_FILE_TOOLS = [
  'count_contacts',
  'list_precincts',
  'crud_saved_filters',
  'describe_filter_dimensions',
]

// The position the seeded id names. It is NOT a row in this database —
// `organization.positionId` holds an election-api id that DistrictResolver
// fetches over HTTP — so there is nothing to seed that would make it resolve,
// and useTestService answers getPositionById with null by design ("suites that
// need a real position stub it themselves"). This is that re-spy, and it is the
// whole of what a deployment with election-api reachable would supply.
//
// What it does NOT do is manufacture a district for an org with no positionId:
// resolveByOrgSlug returns null on the missing column before it ever asks. So
// the negative case below still fails on the seed, which is what makes it proof
// that the seed is the thing that was missing.
//
// Scoped to one read, and put BACK to null rather than restored. The service is
// a singleton, so a position left resolving would silently supply a district to
// the later cases that are about not having one. Restoring would be worse: it
// would drop useTestService's own spy and send the request to the real
// election-api.
const withJudgePosition = async <T>(read: () => Promise<T>): Promise<T> => {
  const spy = vi.spyOn(service.app.get(ElectionsService), 'getPositionById')
  spy.mockResolvedValue(JUDGE_POSITION)
  try {
    return await read()
  } finally {
    spy.mockResolvedValue(null)
  }
}

// Stands in for the Databricks credential. The provider factory returns null
// unless DATABRICKS_* is configured, which is every local and CI process, and
// that null keeps the constituent tool off however well the district resolved.
// Patched onto the container's own handler rather than hand-building one, so
// every other dependency stays the real thing.
//
// Restored after the read: the handler is a singleton and a provider left on
// it would register the tool for every later test in the file — including the
// negative cases below, whose whole point is that the tool stays off.
//
// The PRIOR VALUE is put back rather than the property deleted. Nest declares
// this dependency as a constructor parameter property, which emits
// `this.constituentProvider = constituentProvider` whatever the injected
// value is, so the own property always exists — it just holds `undefined`
// when no credential configured one. A `Object.hasOwn` guard around a delete
// therefore never fires, and the fake would leak for the rest of the file.
const withConstituentProvider = async <T>(
  handler: object,
  read: () => Promise<T>,
): Promise<T> => {
  const provider = new InMemoryDatabricksProvider(new Map())
  const prior = Reflect.get(handler, 'constituentProvider')
  Object.assign(handler, { constituentProvider: provider })
  try {
    return await read()
  } finally {
    Object.assign(handler, { constituentProvider: prior })
  }
}

// Both, because the constituent tool needs the district AND the provider and
// neither is in this process by default.
const withConstituentDeps = <T>(
  handler: object,
  read: () => Promise<T>,
): Promise<T> => withJudgePosition(() => withConstituentProvider(handler, read))

// Opens the conversation the way the runner does, over the real route, because
// every loadContext reads the conversation row and its org slug.
const openConversation = async (
  organizationSlug: string,
  agentId: string,
  anchor?: ChatAnchor,
): Promise<string> => {
  const created = await service.client.post<CreateChatResponse>(
    '/v1/chats',
    { scope: chatScopeFor(agentId), ...(anchor && { anchor }) },
    { headers: { 'X-Organization-Slug': organizationSlug } },
  )
  expect(created.status).toBe(201)
  return CreateChatResponseSchema.parse(created.data).conversationId
}

const seedAndOpen = async (
  agentId: string,
  caseId: string,
  options: SeedChatOrgOptions = {},
) => {
  const seeded = await seedChatOrg(
    service.prisma,
    service.user.id,
    agentId,
    caseId,
    options,
  )
  const conversationId = await openConversation(
    seeded.organizationSlug,
    agentId,
    seeded.anchor,
  )
  return { ...seeded, conversationId }
}

describe('the constituent-data tools a seeded Serve scope registers', () => {
  it('registers both on chief_of_staff', async () => {
    const { conversationId } = await seedAndOpen('chief_of_staff', 'cos-tools')
    const handler = service.app.get(ChiefOfStaffHandler)

    const tools = await withConstituentDeps(handler, async () => {
      const ctx = await handler.loadContext(conversationId, service.user.id)
      // The gate itself, so a failure says which half broke: the resolver
      // produced server-bound filters, and they are the district the seeded
      // id names rather than some other org's. Both halves read WA — a state
      // and a district from two different sources would bind a scope that
      // matches nothing.
      expect(ctx.districtFilters).toEqual([
        { column: 'state_postal_code', value: 'WA' },
        { column: 'City Council', value: 'Judge City Council District 1' },
      ])
      return handler.buildTools(ctx)
    })

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(CONSTITUENT_TOOLS),
    )
  })

  // The seed is the thing that was missing, and this is what says so. Clearing
  // the one column takes the pair back off, through the real resolver: nothing
  // else about the org, the provider or the allowlist changes.
  it('registers neither once organization.positionId is cleared', async () => {
    const { conversationId, organizationSlug } = await seedAndOpen(
      'chief_of_staff',
      'cos-no-position',
    )
    await service.prisma.organization.update({
      where: { slug: organizationSlug },
      data: { positionId: null },
    })
    const handler = service.app.get(ChiefOfStaffHandler)

    const tools = await withConstituentDeps(handler, async () => {
      const ctx = await handler.loadContext(conversationId, service.user.id)
      expect(ctx.districtFilters).toBeNull()
      return handler.buildTools(ctx)
    })

    for (const tool of CONSTITUENT_TOOLS) {
      expect(Object.keys(tools)).not.toContain(tool)
    }
  })

  // Same resolver, same `districtFilters`, same allowlist as chief_of_staff —
  // and the commit documents this file as the verification, so leaving the
  // third Serve scope out of it left that gate proved for two of three.
  it('registers both on priority_flow', async () => {
    const { conversationId } = await seedAndOpen('priority_flow', 'pf-tools')
    const handler = service.app.get(PriorityFlowHandler)

    const tools = await withConstituentDeps(handler, async () => {
      const ctx = await handler.loadContext(conversationId, service.user.id)
      expect(ctx.districtFilters).toEqual([
        { column: 'state_postal_code', value: 'WA' },
        { column: 'City Council', value: 'Judge City Council District 1' },
      ])
      return handler.buildTools(ctx)
    })

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(CONSTITUENT_TOOLS),
    )
  })

  // The negative for this scope too: one scope proving the seed is the cause
  // does not prove it for a scope that resolves its own context.
  it('registers neither on priority_flow once positionId is cleared', async () => {
    const { conversationId, organizationSlug } = await seedAndOpen(
      'priority_flow',
      'pf-no-position',
    )
    await service.prisma.organization.update({
      where: { slug: organizationSlug },
      data: { positionId: null },
    })
    const handler = service.app.get(PriorityFlowHandler)

    const tools = await withConstituentDeps(handler, async () => {
      const ctx = await handler.loadContext(conversationId, service.user.id)
      expect(ctx.districtFilters).toBeNull()
      return handler.buildTools(ctx)
    })

    for (const tool of CONSTITUENT_TOOLS) {
      expect(Object.keys(tools)).not.toContain(tool)
    }
  })

  it('registers both on campaign_assistant, off its own Win mart', async () => {
    const { conversationId } = await seedAndOpen('campaign_assistant', 'ca-cd')
    const handler = service.app.get(CampaignManagerHandler)

    const tools = await withConstituentDeps(handler, async () => {
      const ctx = await handler.loadContext(conversationId, service.user.id)
      expect(ctx.districtFilters).not.toBeNull()
      return handler.buildTools(ctx)
    })

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(CONSTITUENT_TOOLS),
    )
  })
})

describe('the voter-file family a seeded campaign registers', () => {
  // Nothing stubbed: contacts, the org row and the isPro column are all local,
  // so this family needed only the seed and is closed outright.
  it('registers all four for campaign_assistant', async () => {
    const { conversationId } = await seedAndOpen('campaign_assistant', 'ca-vf')
    const handler = service.app.get(CampaignManagerHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.isPro).toBe(true)
    const tools = Object.keys(handler.buildTools(ctx))

    expect(tools).toEqual(expect.arrayContaining(VOTER_FILE_TOOLS))
  })

  // The other tool the thin campaign was costing: registered on
  // `details.raceId`, which nothing used to write.
  it('registers get_ballot_requirements off the seeded race', async () => {
    const { conversationId } = await seedAndOpen('campaign_assistant', 'ca-br')
    const handler = service.app.get(CampaignManagerHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.raceId).toBe('judge-race-1')
    expect(Object.keys(handler.buildTools(ctx))).toContain(
      'get_ballot_requirements',
    )
  })

  // On the column the gate actually reads. `isPro` defaults to false, which
  // is the state every one of these runs was in: a free campaign keeps
  // counting and the catalog, and loses only the tools whose services refuse
  // it.
  it('keeps counting but not precincts or saved lists once the campaign is not Pro', async () => {
    const { conversationId, organizationSlug } = await seedAndOpen(
      'campaign_assistant',
      'ca-free',
    )
    await service.prisma.campaign.update({
      where: { organizationSlug },
      data: { isPro: false },
    })
    const handler = service.app.get(CampaignManagerHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.isPro).toBe(false)
    const tools = Object.keys(handler.buildTools(ctx))

    expect(tools).toContain('count_contacts')
    expect(tools).toContain('describe_filter_dimensions')
    expect(tools).not.toContain('list_precincts')
    expect(tools).not.toContain('crud_saved_filters')
  })
})

describe('the ordinance step the seeder anchors on', () => {
  it('still opens on clarify when no step is asked for', async () => {
    const { conversationId } = await seedAndOpen(
      'ordinance_flow',
      'ord-default',
    )
    const handler = service.app.get(OrdinanceFlowHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.step).toBe('clarify')
    const tools = Object.keys(handler.buildTools(ctx))

    expect(tools).toEqual(
      expect.arrayContaining(['ask_clarify_question', 'save_synthesis']),
    )
    expect(tools).not.toContain('present_draft')
  })

  // The steps past clarify, each reached only through the parameter and each
  // carrying a tool no other step has. Asserted per step rather than as one
  // set, so a step that silently stopped registering its own tool names
  // itself.
  it.each([
    ['authority', 'present_authority_finding'],
    ['current_law', 'save_existing_law'],
    ['comparables', 'present_comparables'],
    ['draft', 'present_draft'],
    ['review', 'apply_draft_edit'],
  ] as const)('reaches %s, which registers %s', async (step, tool) => {
    const { conversationId } = await seedAndOpen(
      'ordinance_flow',
      `ord-${step}`,
      { step },
    )
    const handler = service.app.get(OrdinanceFlowHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.step).toBe(step)
    expect(Object.keys(handler.buildTools(ctx))).toContain(tool)
  })

  // Not a registration condition — no step gates a tool on it — but it is what
  // the authority, current_law and comparables prompts reason about, and it was
  // null on every run.
  //
  // Read with NO position stubbed, which is the local and CI reality and is
  // also the only path that reaches the code record: the handler's district
  // resolver OVERWRITES this jurisdiction whenever it resolves, so a resolved
  // position would report its district here instead of the municipality. That
  // makes the code record the source wherever election-api is out of reach,
  // which is exactly where it is needed.
  it('knows its own municipality from the seeded code record', async () => {
    const { conversationId } = await seedAndOpen('ordinance_flow', 'ord-juris')
    const handler = service.app.get(OrdinanceFlowHandler)

    const ctx = await handler.loadContext(conversationId, service.user.id)
    expect(ctx.jurisdiction).toBe('Judge City, WA')
  })
})

// BRIEFING CHAT, which the registry cannot open: its conversation is created
// with its annotation by POST /v1/briefing-chats, so that is the route used
// here, exactly as the runner uses it. The artifact is the fixture the seam
// serves for the seeded bucket, because no test process can reach S3.
describe('the tools a seeded briefing registers', () => {
  const seedAndOpenBriefing = async (
    caseId: string,
    options: SeedChatOrgOptions = {},
  ) => {
    const seeded = await seedChatOrg(
      service.prisma,
      service.user.id,
      'briefing_annotation',
      caseId,
      options,
    )
    if (seeded.briefing === undefined) {
      throw new Error('the briefing seed returned no briefing to open')
    }
    const created = await service.client.post<CreateBriefingChatResponse>(
      '/v1/briefing-chats',
      seeded.briefing,
    )
    expect(created.status).toBe(201)
    return {
      ...seeded,
      ...createBriefingChatResponseSchema.parse(created.data),
    }
  }

  const withFixture = async <T>(read: () => Promise<T>): Promise<T> => {
    const seam = installBriefingFixture({
      bucket: JUDGE_BRIEFING_BUCKET,
      artifactContent: JUDGE_BRIEFING_ARTIFACT,
      today: JUDGE_BRIEFING_TODAY,
    })
    try {
      return await read()
    } finally {
      seam.restore()
    }
  }

  it('registers get_artifacts and get_my_notes', async () => {
    const { conversationId } = await seedAndOpenBriefing('br-tools')
    const handler = service.app.get(BriefingAnnotationHandler)

    const ctx = await withFixture(() =>
      handler.loadContext(conversationId, service.user.id),
    )
    // Parsed, which is what get_artifacts reads and what the prompt's
    // structured block is built from: a markdown artifact would leave it null.
    expect(ctx.parsed?.meeting.cityName).toBe('Hendersonville')
    expect(ctx.notesCount).toBe(1)
    expect(Object.keys(handler.buildTools(ctx))).toEqual(
      expect.arrayContaining(['get_artifacts', 'get_my_notes']),
    )
  })

  // The note recall case reads this: the body, and the passage it was
  // written against, resolved through the same JSON Pointer production uses.
  it('seeds a note that resolves to its highlighted passage', async () => {
    const { briefing } = await seedAndOpenBriefing('br-note')
    expect(briefing).toBeDefined()
    const row = await service.prisma.meetingBriefing.findFirstOrThrow()
    const notes = await service.app.get(BriefingNotesService).loadNotesForChat({
      userId: service.user.id,
      briefingId: row.id,
      artifactContent: JUDGE_BRIEFING_ARTIFACT,
    })
    expect(notes.map((n) => [n.body, n.highlightedText])).toEqual([
      [JUDGE_NOTE.body, '$24M revenue bond rating review'],
    ])
  })

  // The district pair is resolved from the briefing's own organization, the
  // one this case seeded, and only a credentialed deployment has the
  // warehouse provider, so both deployment halves are supplied here the way
  // the Serve scopes above supply them.
  const briefingToolsUnderCredentials = async (
    conversationId: string,
  ): Promise<string[]> => {
    const handler = service.app.get(BriefingAnnotationHandler)
    const prior = Reflect.get(handler, 'databricks')
    Object.assign(handler, {
      databricks: new InMemoryDatabricksProvider(new Map()),
    })
    try {
      return await withJudgePosition(() =>
        withFixture(async () =>
          Object.keys(
            handler.buildTools(
              await handler.loadContext(conversationId, service.user.id),
            ),
          ),
        ),
      )
    } finally {
      Object.assign(handler, { databricks: prior })
    }
  }

  it('registers district_insights under a credentialed deployment', async () => {
    const { conversationId } = await seedAndOpenBriefing('br-district')
    expect(await briefingToolsUnderCredentials(conversationId)).toEqual(
      expect.arrayContaining(['district_insights', 'list_district_topics']),
    )
  })

  // THE CASE'S OWN district state reaches the chat. Seeded after a case that
  // HAS a district, so a resolver that read any office but this case's would
  // find a position and register the pair anyway.
  it("honours this case's district: false, not an earlier case's", async () => {
    await seedAndOpenBriefing('br-with-district')
    const { conversationId } = await seedAndOpenBriefing('br-no-district', {
      district: false,
    })
    const tools = await briefingToolsUnderCredentials(conversationId)
    expect(tools).not.toContain('district_insights')
    expect(tools).not.toContain('list_district_topics')
  })

  // THE RETIREMENT IS NARROW, and every filter on it is load-bearing. It
  // deletes only this user's judge-seeded briefings on the fixture date; a
  // filter dropped would delete, respectively, a real briefing of the same
  // user, another user's judge briefing, or a judge briefing on another day.
  it('retires nothing but its own judge briefings on the fixture date', async () => {
    const briefingFor = async (
      userId: number,
      organizationSlug: string,
      meetingDate: string,
    ): Promise<string> => {
      await service.prisma.organization.create({
        data: { slug: organizationSlug, ownerId: userId },
      })
      const office = await service.prisma.electedOffice.create({
        data: { organizationSlug, userId },
      })
      const run = await service.prisma.experimentRun.create({
        data: {
          organizationSlug,
          experimentType: 'meeting_briefing',
          status: ExperimentRunStatus.COMPLETED,
        },
      })
      const briefing = await service.prisma.meetingBriefing.create({
        data: {
          electedOfficeId: office.id,
          meetingDate: parseIsoDateAsUTC(meetingDate),
          meetingTime: '6:30 PM',
          meetingTimezone: 'America/New_York',
          experimentRunId: run.runId,
          artifactBucket: 'briefing-artifacts',
          artifactKey: `${organizationSlug}/briefing.json`,
        },
      })
      return briefing.id
    }
    const otherUser = await service.prisma.user.create({
      data: { email: 'judge-bystander@goodparty.org' },
    })
    const bystanders = [
      // A real office of the same user, on the fixture date.
      await briefingFor(service.user.id, 'real-office', JUDGE_MEETING_DATE),
      // Another user's judge briefing on the fixture date.
      await briefingFor(otherUser.id, 'judge-other-user', JUDGE_MEETING_DATE),
      // This user's judge briefing on another day.
      await briefingFor(service.user.id, 'judge-other-day', '2026-05-20'),
    ]

    await seedChatOrg(
      service.prisma,
      service.user.id,
      'briefing_annotation',
      'a',
    )

    const left = await service.prisma.meetingBriefing.findMany({
      where: { id: { in: bystanders } },
      select: { id: true },
    })
    expect(left.map((b) => b.id).sort()).toEqual([...bystanders].sort())
  })

  // The route finds a briefing by (meeting date, caller's office) and
  // production has one office per user; an arm seeds one per case. Leaving
  // the earlier briefing would route a later case onto it.
  it("retires the previous case's briefing on the same date", async () => {
    await seedChatOrg(
      service.prisma,
      service.user.id,
      'briefing_annotation',
      'a',
    )
    const second = await seedChatOrg(
      service.prisma,
      service.user.id,
      'briefing_annotation',
      'b',
    )

    const briefings = await service.prisma.meetingBriefing.findMany({
      include: { electedOffice: true },
    })
    expect(briefings.map((b) => b.electedOffice.organizationSlug)).toEqual([
      second.organizationSlug,
    ])
  })
})
