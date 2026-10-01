import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  emptyPriorityStatus,
} from '@goodparty_org/contracts'
import { ChatScope, type Organization } from '../../../generated/prisma'
import { ChatScopeRegistry } from '../services/chatScopeRegistry.service'
import {
  CHAT_SCOPE_HANDLERS,
  type ChatScopeHandler,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import {
  PRIORITY_FLOW_MODELS,
  PriorityFlowHandler,
} from './priorityFlow.handler'
import {
  PriorityFlowContext,
  PriorityFlowContextService,
} from './services/priorityFlowContext.service'
import { PriorityFlowOutreachService } from './services/priorityFlowOutreach.service'

const USER_ID = 11
const ORG = 'eo-maple'

const ANCHOR = {
  resourceType: 'priority' as const,
  resourceId: 'pri-1',
  url: 'https://goodparty.org/serve/priorities/pri-1',
  snapshot: {
    title: 'Sidewalk repairs on Maple Ave',
    summary: 'Cracked sidewalks are unsafe for residents with strollers.',
  },
}

const baseCtx = (): PriorityFlowContext => ({
  conversationId: 'c1',
  priorityId: 'pri-1',
  electedOfficeId: 'office-1',
  organizationSlug: ORG,
  organization: { slug: ORG } as Organization,
  officeTitle: 'City Council Member',
  jurisdiction: null,
  title: 'Sidewalk repairs on Maple Ave',
  description: 'Cracked sidewalks are unsafe for residents with strollers.',
  source: 'user_stated',
  status: emptyPriorityStatus(),
  anchorSummaries: [],
  districtFilters: null,
  constituentToolEnabled: false,
})

describe('PriorityFlowHandler', () => {
  let store: GeneralChatStoreService
  let context: PriorityFlowContextService
  let outreach: PriorityFlowOutreachService
  let priorityStatus: PriorityStatusService

  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey
  })

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    store = {
      findByAnchorResource: vi.fn(() => Promise.resolve([])),
      createScopedConversation: vi.fn(() => Promise.resolve({ id: 'fresh' })),
    } as unknown as GeneralChatStoreService
    context = {
      load: vi.fn(() => Promise.resolve(baseCtx())),
      assertPriorityOwnership: vi.fn(() => Promise.resolve()),
    } as unknown as PriorityFlowContextService
    outreach = {} as unknown as PriorityFlowOutreachService
    priorityStatus = {
      buildStatusTool: vi.fn(() => ({
        update_priority_status: {
          description: 'stub',
          inputSchema: undefined,
          execute: () => ({}),
        },
      })),
    } as unknown as PriorityStatusService
  })

  const build = (districtResolver?: {
    resolveByOrgSlug: ReturnType<typeof vi.fn>
    toMandatoryFilters: ReturnType<typeof vi.fn>
  }) =>
    new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      [],
      undefined,
      districtResolver as never,
    )

  it('is a sensitive, Anthropic-only scope the registry resolves', () => {
    const handler = build()
    expect(handler.scope).toBe(ChatScope.priority_flow)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...PRIORITY_FLOW_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)

    const registry = new ChatScopeRegistry([handler as ChatScopeHandler])
    expect(registry.has(ChatScope.priority_flow)).toBe(true)
    expect(registry.get(ChatScope.priority_flow)).toBe(handler)
    expect(CHAT_SCOPE_HANDLERS).toBe('CHAT_SCOPE_HANDLERS')
  })

  it('creates one conversation when the priority has none', async () => {
    const result = await build().resolveConversation(
      {
        scope: ChatScope.priority_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'fresh', created: true })
    expect(store.createScopedConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: USER_ID,
        organizationSlug: ORG,
        scope: ChatScope.priority_flow,
        anchor: ANCHOR,
        title: 'Sidewalk repairs on Maple Ave',
      }),
    )
  })

  it('returns the same conversation on a second open of the same priority', async () => {
    const handler = build()
    const first = await handler.resolveConversation(
      {
        scope: ChatScope.priority_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    store.findByAnchorResource = vi.fn(() =>
      Promise.resolve([{ id: first.conversationId, anchor: ANCHOR }]),
    ) as never
    const second = await handler.resolveConversation(
      {
        scope: ChatScope.priority_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    expect(second).toEqual({ conversationId: 'fresh', created: false })
    expect(store.createScopedConversation).toHaveBeenCalledTimes(1)
  })

  it('gives a different priority its own conversation', async () => {
    const handler = build()
    await handler.resolveConversation(
      {
        scope: ChatScope.priority_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    store.createScopedConversation = vi.fn(() =>
      Promise.resolve({ id: 'other' }),
    ) as never
    const other = await handler.resolveConversation(
      {
        scope: ChatScope.priority_flow,
        organizationSlug: ORG,
        anchor: { ...ANCHOR, resourceId: 'pri-2' },
      },
      USER_ID,
    )
    expect(other).toEqual({ conversationId: 'other', created: true })
    expect(store.findByAnchorResource).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: 'pri-2' }),
    )
  })

  it('will not create a conversation for a priority the caller does not own', async () => {
    context.assertPriorityOwnership = vi.fn(() =>
      Promise.reject(new NotFoundException('Priority not found')),
    ) as never
    await expect(
      build().resolveConversation(
        {
          scope: ChatScope.priority_flow,
          organizationSlug: ORG,
          anchor: ANCHOR,
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(store.createScopedConversation).not.toHaveBeenCalled()
  })

  it('rejects a request without a priority anchor', async () => {
    await expect(
      build().resolveConversation(
        { scope: ChatScope.priority_flow, organizationSlug: ORG },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      build().resolveConversation(
        {
          scope: ChatScope.priority_flow,
          organizationSlug: ORG,
          anchor: {
            resourceType: 'ordinance',
            resourceId: 'ord-1',
            url: 'https://goodparty.org/ordinances/ord-1',
            snapshot: { title: 'Noise', summary: 'Limit noise.' },
            step: 'clarify',
          },
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('builds the priority tool belt', () => {
    const names = Object.keys(build().buildTools(baseCtx())).sort()
    expect(names).toEqual([
      'ask_clarify_question',
      'present_outreach_proposal',
      'present_outside_contact',
      'present_past_outreach',
      'read_past_outreach',
      'update_priority_status',
      'web_search',
    ])
    expect(priorityStatus.buildStatusTool).toHaveBeenCalledWith('pri-1')
  })

  it('adds the CRM and community-issue tools when those services resolve', () => {
    const handler = new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      [],
      undefined,
      undefined,
      { getDetail: vi.fn() },
      {
        getFilterDimensions: vi.fn(() => []),
        countContacts: vi.fn(),
        countSegment: vi.fn(),
      } as never,
      {} as never,
    )
    const names = Object.keys(handler.buildTools(baseCtx()))
    expect(names).toContain('describe_filter_dimensions')
    expect(names).toContain('count_contacts')
    expect(names).toContain('crud_saved_filters')
    expect(names).toContain('read_community_issues')
  })

  it('sets deepLinkOnly from the channel, not from what the model passed', async () => {
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const proposal = {
      audience: 'Maple Ave households',
      count: 312,
      channel: 'social' as const,
      message: 'Sidewalk repairs start next month.',
      why: 'These are the households on the blocks being repaired.',
      deepLinkOnly: false,
    }
    expect(await tool.execute(proposal)).toEqual({
      presented: true,
      deepLinkOnly: true,
    })
    expect(
      await tool.execute({ ...proposal, channel: 'phoneBanking' as const }),
    ).toEqual({ presented: true, deepLinkOnly: false })
  })

  it('asks a structured question without touching the status', async () => {
    const tool = build().buildTools(baseCtx()).ask_clarify_question
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    expect(
      await tool.execute({
        questionId: 'q1',
        question: 'Which blocks do you want repaired first?',
        options: [{ label: 'The two by the school' }, { label: 'Maple Ave' }],
      }),
    ).toEqual({ asked: true, questionId: 'q1' })
  })

  it('tells the agent to ask with the tool rather than in prose', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('Ask it with ask_clarify_question, never in prose')
    expect(prompt).toContain('One question at a time')
  })

  it('never lets the agent write the clarify question as chat text', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).not.toContain('lead-in line')
    expect(prompt).toContain('never write it, or any rewording of it')
    expect(prompt).toContain('it never ends in a question')
    expect(prompt).toContain(
      'Never end a message with an either/or or a pick-one question in prose',
    )
  })

  it('raises maxSteps above the default so a research turn can finish', () => {
    expect(build().maxSteps).toBe(30)
  })

  it('renders a status block for a fresh priority', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('chief of staff')
    expect(prompt).toContain('Sidewalk repairs on Maple Ave')
    expect(prompt).toContain('<status>')
    expect(prompt).toContain(
      'define (The problem): open. Nothing recorded yet.',
    )
    expect(prompt).toContain('plan (The plan): open. Nothing recorded yet.')
    expect(prompt).toContain('Nothing has been left in this thread yet.')
    expect(prompt).toContain('ONE STEP AT A TIME')
    expect(prompt).toContain('WHEN TO GO BACK')
  })

  it('defines every step with what it is, its bar and what it unlocks', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    for (const id of PRIORITY_STEP_IDS) {
      expect(prompt).toContain(`- ${id} (${PRIORITY_STEP_LABELS[id]})`)
    }
    expect(prompt.match(/ {2}What it is: /g)).toHaveLength(7)
    expect(prompt.match(/ {2}Settled when: /g)).toHaveLength(7)
    expect(prompt.match(/ {2}Unlocks: /g)).toHaveLength(7)
    expect(prompt).toContain('Exactly one step is active at any moment')
    expect(prompt).toContain(
      'New information has to meaningfully invalidate what that step',
    )
  })

  it('renders the thread block from the resolved anchor summaries', () => {
    const prompt = build().buildSystemPrompt({
      ...baseCtx(),
      anchorSummaries: [
        {
          kind: 'outreach_proposal',
          ref: 'outreach:412',
          line: 'Maple Ave walk zone, 312 recipients, sent 28 Sep, 14 replies',
        },
      ],
    })
    expect(prompt).toContain(
      'outreach:412 — Maple Ave walk zone, 312 recipients, sent 28 Sep, 14 replies',
    )
  })

  it('fills jurisdiction from the district resolver, keyed by org slug', async () => {
    const resolveByOrgSlug = vi.fn(() =>
      Promise.resolve({ l2DistrictName: 'Ward 3', state: 'NC' }),
    )
    const toMandatoryFilters = vi.fn(() => [])
    const ctx = await build({
      resolveByOrgSlug,
      toMandatoryFilters,
    }).loadContext('c1', USER_ID)
    expect(resolveByOrgSlug).toHaveBeenCalledWith(ORG)
    expect(ctx.jurisdiction).toBe('Ward 3, NC')
  })

  it('leaves jurisdiction null when the resolver finds nothing', async () => {
    const resolveByOrgSlug = vi.fn(() => Promise.resolve(null))
    const toMandatoryFilters = vi.fn(() => [])
    const ctx = await build({
      resolveByOrgSlug,
      toMandatoryFilters,
    }).loadContext('c1', USER_ID)
    expect(ctx.jurisdiction).toBeNull()
  })
})
