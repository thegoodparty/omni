import { describe, expect, it, vi } from 'vitest'
import {
  CreateChatResponseSchema,
  type ChatAnchor,
  type CreateChatResponse,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { ChiefOfStaffHandler } from '@/chats/general/chief-of-staff/chiefOfStaff.handler'
import { CampaignManagerHandler } from '@/chats/general/campaign-manager/campaignManager.handler'
import { OrdinanceFlowHandler } from '@/chats/general/ordinance-flow/ordinanceFlow.handler'
import { InMemoryDatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
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
// Removed after the read: the handler is a singleton and a provider left on it
// would register the tool for every later test in the file.
const withConstituentProvider = async <T>(
  handler: object,
  read: () => Promise<T>,
): Promise<T> => {
  const provider = new InMemoryDatabricksProvider(new Map())
  const had = Object.hasOwn(handler, 'constituentProvider')
  Object.assign(handler, { constituentProvider: provider })
  try {
    return await read()
  } finally {
    if (!had) Reflect.deleteProperty(handler, 'constituentProvider')
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

  // The negative, on the column the gate actually reads. `isPro` defaults to
  // false, which is the state every one of these runs was in.
  it('registers none of the four once the campaign is not Pro', async () => {
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

    for (const tool of VOTER_FILE_TOOLS) {
      expect(tools).not.toContain(tool)
    }
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
