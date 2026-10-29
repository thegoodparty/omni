import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  HIGH_CONFIDENCE_MIN_REPLIES,
  HIGH_CONFIDENCE_MIN_SHARE,
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  emptyPriorityStatus,
  PROPOSAL_SENT_MARKER,
  REPORT_BACK_MARKER,
  GET_ANSWERS_MARKER,
  type PriorityReadStatus,
} from '@goodparty_org/contracts'
import type { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import type { OutreachReportBackService } from '@/outreach/services/outreachReportBack.service'
import type { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import { ChatScope, type Organization } from '../../../generated/prisma'
import { ChatScopeRegistry } from '../services/chatScopeRegistry.service'
import {
  CHAT_SCOPE_HANDLERS,
  type ChatScopeHandler,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CLAIM_STRENGTH_RULE,
  LEGAL_VALUES_RULE,
} from '../services/claimConfidence'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import {
  PRIORITY_FLOW_MODELS,
  PriorityFlowHandler,
} from './priorityFlow.handler'
import {
  PriorityFlowContext,
  type PriorityManagedCivicPanel,
  PriorityFlowContextService,
} from './services/priorityFlowContext.service'
import { PriorityFlowOutreachService } from './services/priorityFlowOutreach.service'
import { HELD_BACK_NOTE } from '../chat-tools/readOutreachFeedback.tool'

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
  officialName: 'Bryan Ortiz',
  jurisdiction: null,
  title: 'Sidewalk repairs on Maple Ave',
  description: 'Cracked sidewalks are unsafe for residents with strollers.',
  source: 'user_stated',
  sourceCommunityIssueId: null,
  status: emptyPriorityStatus(),
  anchorSummaries: [],
  districtFilters: null,
  constituentToolEnabled: false,
  peopleDataset: { base: 'voters' },
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
    outreach = {
      summarizeAnchors: vi.fn(() => Promise.resolve([])),
    } as unknown as PriorityFlowOutreachService
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
      { voters: [], constituents: [] },
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
      'present_authority_finding',
      'present_comparables',
      'present_current_law_summary',
      'present_outreach_proposal',
      'present_outside_contact',
      'present_past_outreach',
      'read_past_outreach',
      'size_outreach_sample',
      'update_priority_status',
      'web_search',
    ])
    expect(priorityStatus.buildStatusTool).toHaveBeenCalledWith(
      'pri-1',
      expect.objectContaining({
        offered: expect.any(Function),
        startedAt: expect.any(String),
      }),
    )
  })

  it('reads outreach feedback only with serve-citizen-panels on', () => {
    const on = { ...baseCtx(), outreachFeedbackEnabled: true }
    expect(Object.keys(build().buildTools(on))).toContain(
      'read_outreach_feedback',
    )
    expect(build().buildSystemPrompt(on)).toContain(
      'call read_outreach_feedback before you say anything about it',
    )

    expect(Object.keys(build().buildTools(baseCtx()))).not.toContain(
      'read_outreach_feedback',
    )
    expect(build().buildSystemPrompt(baseCtx())).not.toContain(
      'read_outreach_feedback',
    )
  })

  it('tells the status tool when a card or a question went out this turn', async () => {
    const tools = build().buildTools(baseCtx())
    const offered = vi.mocked(priorityStatus.buildStatusTool).mock.calls[0]?.[1]
      ?.offered
    if (offered === undefined) throw new Error('expected the offer reader')
    expect(offered()).toBe(false)

    const ask = tools.ask_clarify_question
    if (ask === undefined || !('execute' in ask)) {
      throw new Error('expected an executable tool')
    }
    await ask.execute({
      questionId: 'q1',
      question: 'Want to check this with them?',
      options: [{ label: 'Ask both groups' }, { label: 'Not yet' }],
    })
    expect(offered()).toBe(true)

    const fresh = build()
    fresh.buildTools(baseCtx())
    const nextTurn = vi.mocked(priorityStatus.buildStatusTool).mock
      .calls[1]?.[1]?.offered
    expect(nextTurn?.()).toBe(false)
  })

  it('adds the CRM and community-issue tools when those services resolve', () => {
    const handler = new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      { voters: [], constituents: [] },
      undefined,
      undefined,
      { list: vi.fn(), getDetail: vi.fn() },
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
    expect(names).toContain('list_precincts')
    expect(names).toContain('read_community_issues')
  })

  const buildWithCrm = () =>
    new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      { voters: [], constituents: [] },
      undefined,
      undefined,
      undefined,
      {
        getFilterDimensions: vi.fn(() => []),
        countContacts: vi.fn(),
        countSegment: vi.fn(),
      } as never,
      {} as never,
    )

  it('reads the constituent table its org resolves to, once per turn', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ base: 'constituents' as const }),
    )
    const handler = new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      {
        voters: [{ table: 'serve_agent_voters', dimensions: ['Voters_Age'] }],
        constituents: [
          { table: 'serve_agent_constituents', dimensions: ['Voters_Age'] },
        ],
      },
      { query: vi.fn() },
      {
        resolveByOrgSlug: vi.fn(() =>
          Promise.resolve({ state: 'MI', l2DistrictName: 'Lansing' }),
        ),
        toMandatoryFilters: vi.fn(() => [
          { column: 'state_postal_code', value: 'MI' },
        ]),
      } as never,
      undefined,
      undefined,
      undefined,
      { resolve } as never,
    )
    const ctx = await handler.loadContext('c1', 7)
    const tool = handler.buildTools(ctx).query_constituent_data

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(ctx.peopleDataset).toEqual({ base: 'constituents' })
    expect(tool && 'description' in tool && tool.description).toContain(
      'FROM serve_agent_constituents',
    )
  })

  it("prints a side's set-up day in the office's zone, not the raw instant", () => {
    const status = emptyPriorityStatus()
    // 11:11 pm Pacific on Oct 21 is already Oct 22 in UTC.
    const prompt = build().buildSystemPrompt({
      ...baseCtx(),
      state: 'CA',
      status: {
        ...status,
        steps: status.steps.map((step) =>
          step.id === 'define'
            ? {
                ...step,
                check: {
                  state: 'out' as const,
                  who: 'Renters',
                  question: 'Is it the drains?',
                  raised: 0,
                  sentAt: '2026-10-22T06:11:00.000Z',
                },
              }
            : step,
        ),
      },
    })
    expect(prompt).toContain('Set up on 2026-10-21.')
    expect(prompt).not.toContain('2026-10-22T06:11')
  })

  it("loads today and the thread's send days in the resolved office's zone", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 1:00 am Eastern on Oct 22 is still Oct 21 in Wyoming.
    vi.setSystemTime(new Date('2026-10-22T05:00:00.000Z'))
    try {
      const summarizeAnchors = vi.fn(() =>
        Promise.resolve([
          {
            kind: 'outreach_proposal' as const,
            ref: 'outreach:3834',
            line: 'Riverside renters, 5000 recipients, scheduled for 2026-10-27, not sent yet, 0 replies',
          },
        ]),
      )
      outreach.summarizeAnchors = summarizeAnchors
      const handler = build({
        resolveByOrgSlug: vi.fn(() =>
          Promise.resolve({ l2DistrictName: 'Ward 1', state: 'WY' }),
        ),
        toMandatoryFilters: vi.fn(() => []),
      })
      const ctx = await handler.loadContext('c1', USER_ID)
      const prompt = handler.buildSystemPrompt(ctx)

      expect(summarizeAnchors).toHaveBeenCalledWith('pri-1', 'US/Mountain')
      expect(prompt).toContain(
        'Today is Wednesday, October 21, 2026 (Mountain Time).',
      )
      expect(prompt).toContain('scheduled for 2026-10-27, not sent yet')
    } finally {
      vi.useRealTimers()
    }
  })

  it("tells the assistant what day it is, in the office state's zone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    try {
      const prompt = buildWithCrm().buildSystemPrompt({
        ...baseCtx(),
        state: 'TX',
      })
      expect(prompt).toContain(
        'Today is Monday, October 5, 2026 (Central Time).',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('adds the affectedness method, the list work and sampling only with the CRM tools', () => {
    const withCrm = buildWithCrm().buildSystemPrompt(baseCtx())
    const without = build().buildSystemPrompt(baseCtx())
    for (const section of [
      'HOW TO CHOOSE WHO TO HEAR FROM',
      'BUILD THE CHECK BEFORE YOU OFFER IT',
      'HOW MANY PEOPLE TO ASK',
    ]) {
      expect(withCrm).toContain(section)
      expect(without).not.toContain(section)
    }
  })

  it('holds claims and legal readings to the shared confidence rules', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    expect(prompt).toContain(CLAIM_STRENGTH_RULE)
    expect(prompt).toContain(LEGAL_VALUES_RULE)
  })

  it('backstops a legal reading with the professional-advice line', () => {
    expect(
      build().finalizeAssistantText('Under RCW 35.21.766 you can do this.'),
    ).toContain('not a substitute for professional advice')
    expect(build().finalizeAssistantText('Potholes cluster downtown.')).toBe(
      null,
    )
  })

  it('offers the finding cards as display-only tools', async () => {
    const tools = build().buildTools(baseCtx())
    for (const name of [
      'present_comparables',
      'present_current_law_summary',
      'present_authority_finding',
    ]) {
      expect(tools[name]).toBeDefined()
    }
    const authority = tools.present_authority_finding as {
      execute: (input: unknown) => unknown
    }
    expect(await authority.execute({})).toEqual({ presented: true })
  })

  it('holds a thin read back to the same reply bar as polls', () => {
    expect(build().buildSystemPrompt(baseCtx())).toContain(
      `more than ${HIGH_CONFIDENCE_MIN_REPLIES} replies, or replies from at ` +
        `least ${HIGH_CONFIDENCE_MIN_SHARE * 100}% of that side`,
    )
  })

  it('says a sample no smaller than its audience goes to all of it', async () => {
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const proposal = {
      audience: 'Maple Ave households',
      count: 312,
      channel: 'phoneBanking' as const,
      message: 'I am calling for Bryan Ortiz, your City Council Member.',
      why: 'These are the households on the blocks being repaired.',
      deepLinkOnly: false,
    }
    expect(await tool.execute({ ...proposal, sampleSize: 80 })).toEqual({
      presented: true,
      deepLinkOnly: false,
    })
    expect(await tool.execute({ ...proposal, sampleSize: 400 })).toMatchObject({
      wholeAudience: expect.stringContaining('312 people'),
    })
  })

  describe('a proposal kept to the parts not reached yet', () => {
    const AREA = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ] as [number, number][],
      ],
    }
    const withArea = (
      area: typeof AREA | null,
      inside: number,
    ): {
      tool: { execute: (input: never) => Promise<unknown> }
      polygonPreview: ReturnType<typeof vi.fn>
    } => {
      const polygonPreview = vi.fn(() =>
        Promise.resolve({ count: inside, audienceEmpty: false }),
      )
      const handler = new PriorityFlowHandler(
        store,
        context,
        outreach,
        priorityStatus,
        { voters: [], constituents: [] },
        undefined,
        undefined,
        undefined,
        { polygonPreview } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        { unreachedAreaFor: vi.fn(() => Promise.resolve(area)) } as never,
      )
      const tool = handler.buildTools(baseCtx()).present_outreach_proposal
      if (tool === undefined || !('execute' in tool)) {
        throw new Error('expected an executable tool')
      }
      return { tool: tool as never, polygonPreview }
    }
    const proposal = {
      audience: 'Renters in the parts we have not reached',
      count: 120,
      channel: 'phoneBanking' as const,
      message: 'I am calling for Bryan Ortiz, your City Council Member.',
      audienceFilters: { homeownerNo: true },
      areaTarget: 'unreached' as const,
      deepLinkOnly: false,
    }

    it('presents when the count is the audience inside the area', async () => {
      const { tool, polygonPreview } = withArea(AREA, 120)
      expect(await tool.execute(proposal as never)).toMatchObject({
        presented: true,
      })
      expect(polygonPreview).toHaveBeenCalledWith(
        { geoPoly: AREA, filters: { homeownerNo: true } },
        expect.anything(),
      )
    })

    it('tells the agent the count inside the area', async () => {
      const { tool } = withArea(AREA, 45)
      expect(await tool.execute(proposal as never)).toEqual({
        error: expect.stringContaining(
          'that audience is 45 people. Present it again with count 45.',
        ),
      })
    })

    it('refuses when every part has answered', async () => {
      const { tool } = withArea(null, 0)
      expect(await tool.execute(proposal as never)).toEqual({
        error: expect.stringContaining('Every part of the district'),
      })
    })
  })

  it('renders a step check in the status block', () => {
    const status = emptyPriorityStatus()
    const prompt = build().buildSystemPrompt({
      ...baseCtx(),
      status: {
        ...status,
        steps: status.steps.map((step) =>
          step.id === 'define'
            ? {
                ...step,
                state: 'settled' as const,
                summary: 'Cracked slabs on four blocks',
                check: {
                  state: 'deferred' as const,
                  who: 'Households on the four blocks',
                  question: 'Is the sidewalk what keeps you off it?',
                  when: 'after the budget hearing',
                  raised: 1,
                  contrast: {
                    state: 'declined' as const,
                    who: 'Households across town',
                    question: 'Would you pay toward this?',
                    heard: 'Not if it raises the fee',
                  },
                },
              }
            : step,
        ),
      },
    })
    expect(prompt).toContain(
      'define (The problem): settled. Cracked slabs on four blocks ' +
        'Check: deferred. Who: Households on the four blocks. ' +
        'Question: Is the sidewalk what keeps you off it? ' +
        'Timing: after the budget hearing. Raised 1 of 3 times. ' +
        'Least affected: declined. Who: Households across town. ' +
        'Question: Would you pay toward this? Heard: Not if it raises the ' +
        'fee.',
    )
    expect(prompt).toContain(
      'evidence (What we know): open. Nothing recorded yet.\n',
    )
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
      message:
        'Hi, this is Bryan Ortiz, your City Council Member. Repairs start soon.',
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
    expect(
      await tool.execute({ ...proposal, channel: 'doorKnocking' as const }),
    ).toEqual({ presented: true, deepLinkOnly: true })
  })

  it('refuses a draft that is not signed by the official', async () => {
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const text = {
      audience: 'Maple Ave households',
      count: 312,
      channel: 'text' as const,
      why: 'These are the households on the blocks being repaired.',
      deepLinkOnly: false,
    }
    expect(
      await tool.execute({
        ...text,
        message: 'Hi, this is [Your Name] from the city. Is the sidewalk it?',
      }),
    ).toHaveProperty('error')
    expect(
      await tool.execute({
        ...text,
        message: 'Hi, this is the City Council. Is the sidewalk it?',
      }),
    ).toHaveProperty('error')
    expect(
      await tool.execute({
        ...text,
        message:
          'this is Bryan Ortiz, your City Council Member. Is the sidewalk it?',
      }),
    ).toEqual({ presented: true, deepLinkOnly: true })
    expect(
      await tool.execute({
        ...text,
        channel: 'phoneBanking' as const,
        message: 'Hi, I am calling for the City Council. Is the sidewalk it?',
      }),
    ).toHaveProperty('error')
    expect(
      await tool.execute({
        ...text,
        channel: 'phoneBanking' as const,
        message:
          'Hi, I am calling for Bryan Ortiz, your City Council Member. Is it the ' +
          'sidewalk?',
      }),
    ).toEqual({ presented: true, deepLinkOnly: false })
  })

  // A side that went out has been asked; offering it again would ask the
  // same people twice.
  it('refuses to offer a side of a check that already went out', async () => {
    const status = emptyPriorityStatus()
    priorityStatus.read = vi.fn(() =>
      Promise.resolve({
        ...status,
        steps: status.steps.map((step) =>
          step.id === 'define'
            ? {
                ...step,
                state: 'settled' as const,
                check: {
                  state: 'out' as const,
                  who: 'Renters on the flood blocks',
                  question: 'Is it the drains?',
                  raised: 0,
                  sentAt: '2026-09-30T12:00:00Z',
                  sentProposalKey: '3c9a7e51-0d2b-4f6e-9a18-5b7c2d4e6f80',
                },
              }
            : step,
        ),
      }),
    )
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const proposal = {
      audience: 'Renters on the flood blocks',
      count: 260,
      channel: 'phoneBanking' as const,
      message: 'I am calling for Bryan Ortiz, your City Council Member.',
      deepLinkOnly: false,
      stepId: 'define' as const,
    }

    expect(await tool.execute({ ...proposal, side: 'main' })).toHaveProperty(
      'error',
      expect.stringContaining('already went out'),
    )
    expect(await tool.execute({ ...proposal, side: 'contrast' })).toEqual({
      presented: true,
      deepLinkOnly: false,
    })
    expect(
      await tool.execute({
        ...proposal,
        stepId: 'evidence' as const,
        side: 'main',
      }),
    ).toHaveProperty('error')
  })

  // A thin read is widened by asking new people on the same side, which the
  // already-sent refusal above must not block, and must not let a plain
  // re-propose through either.
  it('lets a sent side widen only over sends of that same side', async () => {
    const status = emptyPriorityStatus()
    priorityStatus.read = vi.fn(() =>
      Promise.resolve({
        ...status,
        steps: status.steps.map((step) =>
          step.id === 'define'
            ? {
                ...step,
                state: 'settled' as const,
                check: {
                  state: 'out' as const,
                  who: 'Renters on the flood blocks',
                  question: 'Is it the drains?',
                  raised: 0,
                  sentAt: '2026-09-30T12:00:00Z',
                  sentProposalKey: '3c9a7e51-0d2b-4f6e-9a18-5b7c2d4e6f80',
                },
              }
            : step,
        ),
      }),
    )
    const allPutOutCheck = vi.fn(
      (...args: [string, string, string, number[]]) =>
        Promise.resolve(args[3].every((id) => id === 501)),
    )
    outreach.allPutOutCheck = allPutOutCheck
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const proposal = {
      audience: 'Renters on the flood blocks',
      count: 58_520,
      channel: 'phoneBanking' as const,
      message: 'I am calling for Bryan Ortiz, your City Council Member.',
      deepLinkOnly: false,
      stepId: 'define' as const,
      side: 'main' as const,
      sampleSize: 80,
    }

    expect(
      await tool.execute({ ...proposal, widensOutreachIds: [501] }),
    ).toEqual({ presented: true, deepLinkOnly: false })
    expect(allPutOutCheck).toHaveBeenCalledWith(
      baseCtx().priorityId,
      'define',
      'main',
      [501],
    )
    // A send of some other check, or someone else's, does not count.
    expect(
      await tool.execute({ ...proposal, widensOutreachIds: [777] }),
    ).toHaveProperty('error', expect.stringContaining('this same side'))
    // Without naming what it widens, it is the same people asked twice.
    expect(await tool.execute(proposal)).toHaveProperty(
      'error',
      expect.stringContaining('already went out'),
    )
  })

  it('refuses a proposal whose audience counted nobody', async () => {
    const tool = build().buildTools(baseCtx()).present_outreach_proposal
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    const proposal = {
      audience: 'Nobody',
      count: 0,
      message: 'I am calling for Bryan Ortiz, your City Council Member.',
      deepLinkOnly: false,
      sampleSize: 100,
    }

    const empty = await tool.execute({
      ...proposal,
      channel: 'phoneBanking' as const,
    })
    expect(empty).toHaveProperty('error', expect.stringContaining('nobody'))
    expect(empty).not.toHaveProperty('wholeAudience')
    // A post has no audience to count.
    expect(
      await tool.execute({
        ...proposal,
        channel: 'social' as const,
        sampleSize: undefined,
      }),
    ).toEqual({ presented: true, deepLinkOnly: true })
  })

  it('tells the agent a sent side is out on its own and never offered again', () => {
    const status = emptyPriorityStatus()
    const prompt = buildWithCrm().buildSystemPrompt({
      ...baseCtx(),
      status: {
        ...status,
        steps: status.steps.map((step) =>
          step.id === 'define'
            ? {
                ...step,
                state: 'settled' as const,
                check: {
                  state: 'out' as const,
                  who: 'Renters',
                  question: 'Is it the drains?',
                  raised: 0,
                  sentAt: '2026-09-30T12:00:00Z',
                },
              }
            : step,
        ),
      },
    })
    expect(prompt).toContain(
      'Check: out. Who: Renters. Question: Is it the drains? Set up on 2026-09-30.',
    )
    expect(prompt).not.toContain('Sent:')
    expect(prompt).toContain(PROPOSAL_SENT_MARKER)
  })

  it('does not count a refused question as offered', async () => {
    const tools = build().buildTools(baseCtx())
    const offered = vi.mocked(priorityStatus.buildStatusTool).mock.calls[0]?.[1]
      ?.offered
    const ask = tools.ask_clarify_question
    if (offered === undefined || ask === undefined || !('execute' in ask)) {
      throw new Error('expected the offer reader and the ask tool')
    }
    expect(
      await ask.execute({
        questionId: 'q1',
        question: 'Which pets?',
        options: [{ label: 'Dogs' }, { label: 'Dogs and Cats' }],
        multiSelect: true,
      }),
    ).toHaveProperty('error')
    expect(offered()).toBe(false)
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

  it('raises maxSteps above the default so a research turn can finish', () => {
    expect(build().maxSteps).toBe(30)
  })

  it('renders a status block for a fresh priority', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('Sidewalk repairs on Maple Ave')
    expect(prompt).toContain('<status>')
    expect(prompt).toContain(
      'define (The problem): open. Nothing recorded yet.',
    )
    expect(prompt).toContain('plan (The plan): open. Nothing recorded yet.')
    expect(prompt).toContain('Nothing has been left in this thread yet.')
  })

  it('defines every step with what it is, its bar and what it unlocks', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    for (const id of PRIORITY_STEP_IDS) {
      expect(prompt).toContain(`- ${id} (${PRIORITY_STEP_LABELS[id]})`)
    }
    expect(prompt.match(/ {2}What it is: /g)).toHaveLength(7)
    expect(prompt.match(/ {2}Settled when: /g)).toHaveLength(7)
    expect(prompt.match(/ {2}Unlocks: /g)).toHaveLength(7)
  })

  it.each([null, ''])(
    'names the official and the office from the resolved position when its custom name is %j',
    async (officeTitle) => {
      context.load = vi.fn(() =>
        Promise.resolve({ ...baseCtx(), officeTitle }),
      ) as never
      const handler = build({
        resolveByOrgSlug: vi.fn(() =>
          Promise.resolve({
            l2DistrictName: 'NEW BEDFORD CITY',
            state: 'MA',
            positionName: 'New Bedford City Mayor',
          }),
        ),
        toMandatoryFilters: vi.fn(() => []),
      })

      const ctx = await handler.loadContext('c1', USER_ID)

      expect(ctx.officeTitle).toBe('New Bedford City Mayor')
      expect(handler.buildSystemPrompt(ctx)).toContain(
        "Official's full name: Bryan Ortiz\nOffice: New Bedford City Mayor\nCity/District: NEW BEDFORD CITY, MA\n",
      )
    },
  )

  it('keeps a custom office name over the position name', async () => {
    const ctx = await build({
      resolveByOrgSlug: vi.fn(() =>
        Promise.resolve({
          l2DistrictName: 'Ward 3',
          state: 'NC',
          positionName: 'Raleigh City Council - District 3',
        }),
      ),
      toMandatoryFilters: vi.fn(() => []),
    }).loadContext('c1', USER_ID)

    expect(ctx.officeTitle).toBe('City Council Member')
  })

  it('names the community issue a priority came from in <priority>', () => {
    const prompt = build().buildSystemPrompt({
      ...baseCtx(),
      source: 'community_issue',
      sourceCommunityIssueId: 'issue-7',
    })
    expect(prompt).toContain(
      'Where it came from: community_issue\nCame from community issue: issue-7\n',
    )
  })

  it('leaves the community issue line out when the priority has none', () => {
    expect(build().buildSystemPrompt(baseCtx())).not.toContain(
      'Came from community issue',
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

  describe('behind serve-citizen-panels, round one as a text', () => {
    const panelsOn = (members: number): PriorityFlowContext => ({
      ...baseCtx(),
      outreachFeedbackEnabled: true,
      civicPanelMembers: members,
    })
    const thinRead: PriorityReadStatus = {
      answers: 54,
      needed: 96,
      groupsHeard: 9,
      groupsTotal: 12,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: ['women'],
      checkOut: true,
    }
    const buildWithPanels = () =>
      new PriorityFlowHandler(
        store,
        context,
        outreach,
        priorityStatus,
        { voters: [], constituents: [] },
        undefined,
        undefined,
        undefined,
        {
          getFilterDimensions: vi.fn(() => []),
          countContacts: vi.fn(),
          countSegment: vi.fn(),
          countByGroupWithin: vi.fn(() =>
            Promise.resolve([
              {
                ageBand: '18to64',
                gender: null,
                tract: 't1',
                race: null,
                count: 5_000,
              },
            ]),
          ),
        } as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        {
          districtCensus: vi.fn(() => Promise.resolve(null)),
        } as unknown as PriorityResultsService,
      )

    it('proposes one text card, sized by size_round_one', () => {
      const handler = buildWithPanels()
      expect(Object.keys(handler.buildTools(panelsOn(42)))).toContain(
        'size_round_one',
      )
      const prompt = handler.buildSystemPrompt(panelsOn(42))
      expect(prompt).toContain('ROUND ONE')
      expect(prompt).toContain('Civic panel: 42 members')
      // The targeted groups wait for the read: no contrast card up front.
      expect(prompt).not.toContain('A check you offer has two sides')
    })

    it('never widens a thin read', () => {
      const prompt = buildWithPanels().buildSystemPrompt(panelsOn(42))
      expect(prompt).toContain(
        'A thin read is never widened to more of the same people',
      )
      expect(prompt).not.toContain('Then offer to widen it')

      const off = buildWithPanels().buildSystemPrompt(baseCtx())
      expect(off).toContain('Then offer to widen it')
      expect(off).not.toContain('is never widened')
    })

    it('runs the same round with nobody on the panel yet', () => {
      const prompt = buildWithPanels().buildSystemPrompt(panelsOn(0))
      expect(prompt).toContain('ROUND ONE')
      expect(prompt).toContain('Civic panel: 0 members')
    })

    describe('with the civic panel GoodParty builds', () => {
      const building: PriorityManagedCivicPanel = {
        status: 'building',
        members: 82,
        goalMembers: 240,
        nextSendDate: 'Tuesday, November 3',
        readyWeekOf: 'November 16',
      }
      const withPanel = (
        managedCivicPanel: PriorityManagedCivicPanel | null,
      ): PriorityFlowContext => ({ ...panelsOn(82), managedCivicPanel })

      // The agent told an official whose civic panel was filling for free
      // that the paid round one text was how it gets built.
      it('says it is filling, and never sells the round one text to build it', () => {
        const prompt = buildWithPanels().buildSystemPrompt({
          ...withPanel(building),
          readStatus: { ...thinRead, checkOut: false },
        })
        expect(prompt).toContain(
          'Civic panel: GoodParty is building it with free invites, and it is filling. 82 of 240 members have joined. The next invites go out Tuesday, November 3. It should be ready around the week of November 16.',
        )
        expect(prompt).toContain('THEIR CIVIC PANEL ON THIS PRIORITY')
        expect(prompt).toContain(
          'you can ask their civic panel on this priority once it is ready',
        )
        expect(prompt).not.toContain(
          'Say in one line that it also invites people to join',
        )
      })

      it('says paused and exhausted plainly', () => {
        const paused = buildWithPanels().buildSystemPrompt(
          withPanel({ ...building, status: 'paused', nextSendDate: null }),
        )
        expect(paused).toContain(
          'Civic panel: its invites are paused, so it is not filling until they press Resume invites. 82 of 240 members have joined.',
        )
        expect(paused).not.toContain('GoodParty is building their civic panel')
        expect(paused).not.toContain('GoodParty was building')
        const exhausted = buildWithPanels().buildSystemPrompt(
          withPanel({ ...building, status: 'exhausted', nextSendDate: null }),
        )
        expect(exhausted).toContain(
          'Civic panel: every resident a text can reach has an invite, and it is short of its goal.',
        )
        expect(exhausted).toContain('so what they hear may lean')
        expect(exhausted).not.toContain(
          'GoodParty is building their civic panel',
        )
      })

      it('leads with asking a ready civic panel, and lets the official pick the round', () => {
        const prompt = buildWithPanels().buildSystemPrompt(
          withPanel({
            ...building,
            status: 'ready',
            members: 240,
            nextSendDate: null,
          }),
        )
        expect(prompt).toContain('Civic panel: ready. 240 members.')
        const civicPanel = prompt.indexOf('1. "Ask my civic panel"')
        const text = prompt.indexOf('2. "Text residents across the district"')
        const other = prompt.indexOf('3. "Use another kind of outreach"')
        expect(civicPanel).toBeGreaterThan(-1)
        expect(text).toBeGreaterThan(civicPanel)
        expect(other).toBeGreaterThan(text)
      })

      it('keeps round one first for a civic panel that is not ready', () => {
        const prompt = buildWithPanels().buildSystemPrompt(withPanel(building))
        expect(prompt).not.toContain('1. "Ask my civic panel"')
      })

      it('points to setting one up when GoodParty is not building one', () => {
        const prompt = buildWithPanels().buildSystemPrompt(withPanel(null))
        expect(prompt).toContain('Civic panel: GoodParty is not building one.')
        expect(prompt).toContain('Build my civic panel on their home')
        // Only GoodParty's civic panel invites ask people to join.
        expect(prompt).not.toContain(
          'Say in one line that it also invites people to join',
        )
      })

      it('reads it only with the flag on, and treats stopped as none and a failed read as unknown', async () => {
        context.countCivicPanelMembers = vi.fn(() => Promise.resolve(82))
        const read = vi.fn()
        const handlerWith = (enabled: boolean) =>
          new PriorityFlowHandler(
            store,
            context,
            outreach,
            priorityStatus,
            { voters: [], constituents: [] },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)),
            } as never,
            undefined,
            undefined,
            { read } as unknown as ManagedCivicPanelService,
          )
        const panel = (status: string, wavesSent: number) => ({
          panel: {
            status,
            approvedAt: new Date('2026-10-29T15:00:00Z'),
            progress: {
              members: 82,
              goalMembers: 240,
              wavesSent,
              nextWaveAt: new Date('2026-11-10T15:00:00Z'),
            },
          },
        })

        read.mockResolvedValueOnce(panel('building', 2))
        const on = await handlerWith(true).loadContext('c1', USER_ID)
        expect(on.managedCivicPanel).toEqual(
          expect.objectContaining({
            status: 'building',
            members: 82,
            goalMembers: 240,
            nextSendDate: 'Tuesday, November 10',
          }),
        )

        read.mockResolvedValueOnce(panel('stopped', 2))
        expect(
          (await handlerWith(true).loadContext('c1', USER_ID))
            .managedCivicPanel,
        ).toBeNull()

        read.mockRejectedValueOnce(new Error('boom'))
        expect(
          (await handlerWith(true).loadContext('c1', USER_ID))
            .managedCivicPanel,
        ).toBeUndefined()

        read.mockClear()
        const off = await handlerWith(false).loadContext('c1', USER_ID)
        expect(off.managedCivicPanel).toBeUndefined()
        expect(read).not.toHaveBeenCalled()
      })

      it('reads it once when the conversation opens, and again only on the next open or after a failed read', async () => {
        context.countCivicPanelMembers = vi.fn(() => Promise.resolve(82))
        const read = vi.fn(() =>
          Promise.resolve({
            panel: {
              status: 'ready',
              approvedAt: new Date('2026-10-01T15:00:00Z'),
              progress: {
                members: 240,
                goalMembers: 240,
                wavesSent: 4,
                nextWaveAt: null,
              },
            },
          }),
        )
        store.findByAnchorResource = vi.fn(() =>
          Promise.resolve([{ id: 'c1' }]),
        ) as never
        const handler = new PriorityFlowHandler(
          store,
          context,
          outreach,
          priorityStatus,
          { voters: [], constituents: [] },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { isFeatureEnabled: vi.fn(() => Promise.resolve(true)) } as never,
          undefined,
          undefined,
          { read } as unknown as ManagedCivicPanelService,
        )
        const open = () =>
          handler.resolveConversation(
            {
              scope: ChatScope.priority_flow,
              organizationSlug: ORG,
              anchor: ANCHOR,
            },
            USER_ID,
          )

        await open()
        await handler.loadContext('c1', USER_ID)
        const second = await handler.loadContext('c1', USER_ID)
        expect(second.managedCivicPanel).toEqual(
          expect.objectContaining({ status: 'ready', members: 240 }),
        )
        expect(read).toHaveBeenCalledTimes(1)

        await open()
        await handler.loadContext('c1', USER_ID)
        expect(read).toHaveBeenCalledTimes(2)

        await open()
        read.mockRejectedValueOnce(new Error('boom'))
        expect(
          (await handler.loadContext('c1', USER_ID)).managedCivicPanel,
        ).toBeUndefined()
        await handler.loadContext('c1', USER_ID)
        expect(read).toHaveBeenCalledTimes(4)
      })
    })

    it('keeps the two-sided check where round one cannot be sized', () => {
      const prompt = buildWithCrm().buildSystemPrompt(panelsOn(42))
      expect(prompt).not.toContain('ROUND ONE')
      expect(prompt).toContain('A check you offer has two sides')
      expect(
        Object.keys(buildWithCrm().buildTools(panelsOn(42))),
      ).not.toContain('size_round_one')
    })

    it('behaves as before with the flag off: no panel, both sides up front', () => {
      const prompt = buildWithPanels().buildSystemPrompt(baseCtx())
      expect(prompt).not.toContain('ROUND ONE')
      expect(prompt).not.toContain('size_round_one')
      expect(prompt).not.toContain('Civic panel:')
      expect(prompt).not.toContain('THEIR CIVIC PANEL ON THIS PRIORITY')
      expect(prompt).not.toContain('civicPanelAsk')
      expect(prompt).toContain('A check you offer has two sides')

      const tool =
        buildWithPanels().buildTools(baseCtx()).present_outreach_proposal
      if (tool === undefined || !('inputSchema' in tool) || !tool.inputSchema) {
        throw new Error('expected a schema')
      }
      const parsed = tool.inputSchema.parse({
        audience: 'Residents',
        count: 900,
        channel: 'text',
        message:
          'this is Bryan Ortiz, your City Council Member. Is it the drains?',
        civicPanelAsk: true,
        panelSampleSize: 50,
      })
      expect(parsed).not.toHaveProperty('civicPanelAsk')
      expect(parsed).not.toHaveProperty('panelSampleSize')
    })

    it('reads the panel only with the flag on', async () => {
      const countCivicPanelMembers = vi.fn(() => Promise.resolve(42))
      context.countCivicPanelMembers = countCivicPanelMembers
      const handlerWith = (enabled: boolean) =>
        new PriorityFlowHandler(
          store,
          context,
          outreach,
          priorityStatus,
          { voters: [], constituents: [] },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)),
          } as never,
        )

      const on = await handlerWith(true).loadContext('c1', USER_ID)
      expect(on.civicPanelMembers).toBe(42)
      expect(countCivicPanelMembers).toHaveBeenCalledWith(ORG)

      countCivicPanelMembers.mockClear()
      const off = await handlerWith(false).loadContext('c1', USER_ID)
      expect(off.civicPanelMembers).toBeUndefined()
      expect(countCivicPanelMembers).not.toHaveBeenCalled()
    })

    it('takes a door card on a later round', async () => {
      priorityStatus.read = vi.fn(() => Promise.resolve(emptyPriorityStatus()))
      const tool = buildWithPanels().buildTools(
        panelsOn(42),
      ).present_outreach_proposal
      if (tool === undefined || !('execute' in tool)) {
        throw new Error('expected an executable tool')
      }
      expect(
        await tool.execute({
          audience: 'Renters on the flood blocks',
          deepLinkOnly: false,
          stepId: 'define' as const,
          side: 'contrast' as const,
          channel: 'doorKnocking' as const,
          count: 120,
          audienceFilters: { homeownerNo: true },
          message: 'Hi, I am here for Bryan Ortiz. Is it the drains?',
        }),
      ).toEqual({ presented: true, deepLinkOnly: true })
    })

    it('still checks a panel part as a text with the join ask on', async () => {
      priorityStatus.read = vi.fn(() => Promise.resolve(emptyPriorityStatus()))
      const tool = buildWithPanels().buildTools(
        panelsOn(42),
      ).present_outreach_proposal
      if (tool === undefined || !('execute' in tool)) {
        throw new Error('expected an executable tool')
      }
      const combined = {
        audience: 'Your civic panel and residents across the district',
        count: 18_400,
        channel: 'text' as const,
        message:
          'this is Bryan Ortiz, your City Council Member. Is it the drains?',
        deepLinkOnly: false,
        stepId: 'define' as const,
        side: 'main' as const,
        sampleSize: 84,
        civicPanelAsk: true,
      }

      expect(await tool.execute(combined)).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
      expect(
        await tool.execute({ ...combined, channel: 'phoneBanking' as const }),
      ).toHaveProperty('error')
    })

    it('checks the follow-up size against the split, and offers no third text', async () => {
      priorityStatus.read = vi.fn(() => Promise.resolve(emptyPriorityStatus()))
      const textCard = {
        audience: 'Residents across the district',
        count: 18_400,
        channel: 'text' as const,
        message:
          'this is Bryan Ortiz, your City Council Member. Is it the drains?',
        deepLinkOnly: false,
        stepId: 'define' as const,
        side: 'main' as const,
        sampleSize: 84,
        civicPanelAsk: true,
      }
      const run = async (ctx: PriorityFlowContext, input: object) => {
        const tool = buildWithPanels().buildTools(ctx).present_outreach_proposal
        if (tool === undefined || !('execute' in tool)) {
          throw new Error('expected an executable tool')
        }
        return tool.execute({ ...textCard, ...input })
      }

      expect(await run(panelsOn(42), { roundTwoSize: 84 })).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
      expect(await run(panelsOn(42), { roundTwoSize: 900 })).toHaveProperty(
        'error',
        expect.stringContaining('size_round_one'),
      )
      expect(
        await run(
          {
            ...panelsOn(42),
            readStatus: {
              ...thinRead,
              followUp: { scheduledLocalDate: '2026-11-20', texts: 84 },
            },
          },
          {},
        ),
      ).toHaveProperty('error', expect.stringContaining('already scheduled'))
      expect(
        await run(
          { ...panelsOn(42), readStatus: { ...thinRead, followUpSent: true } },
          {},
        ),
      ).toHaveProperty('error', expect.stringContaining('no third text'))
      expect(
        await run(
          { ...panelsOn(42), readStatus: { ...thinRead, followUpSent: true } },
          { channel: 'doorKnocking', civicPanelAsk: undefined },
        ),
      ).toEqual({ presented: true, deepLinkOnly: true })
    })

    it('presents the round one text card, side main', async () => {
      priorityStatus.read = vi.fn(() => Promise.resolve(emptyPriorityStatus()))
      const tools = buildWithPanels().buildTools(panelsOn(42))
      const { present_outreach_proposal: tool, size_round_one: size } = tools
      if (
        tool === undefined ||
        !('execute' in tool) ||
        size === undefined ||
        !('execute' in size)
      ) {
        throw new Error('expected executable tools')
      }
      const sized = (await size.execute({})) as {
        cards: Array<{ channel: string }>
      }
      expect(sized.cards.map((card) => card.channel)).toEqual(['text'])
      expect(
        await tool.execute({
          audience: 'Residents across the district',
          deepLinkOnly: false,
          stepId: 'define' as const,
          side: 'main' as const,
          channel: 'text' as const,
          count: 9_000,
          sampleSize: 817,
          targetResponses: 24,
          assumedReplyRate: 0.03,
          civicPanelAsk: true,
          audienceFilters: { notContactedRecently: true, hasCellPhone: true },
          message:
            'this is Bryan Ortiz, your City Council Member. Is it the drains?',
        }),
      ).toEqual({ presented: true, deepLinkOnly: true })
    })

    // The targeted group after a thin read leaves out everyone the first send
    // asked, which is a send of the other side when it is the least affected.
    it('lets an unsent side leave out a send of the other side', async () => {
      const status = emptyPriorityStatus()
      priorityStatus.read = vi.fn(() =>
        Promise.resolve({
          ...status,
          steps: status.steps.map((step) =>
            step.id === 'define'
              ? {
                  ...step,
                  state: 'settled' as const,
                  check: {
                    state: 'out' as const,
                    who: 'The panel and new residents',
                    question: 'Is it the drains?',
                    raised: 0,
                    sentAt: '2026-09-30T12:00:00Z',
                    sentProposalKey: '3c9a7e51-0d2b-4f6e-9a18-5b7c2d4e6f80',
                  },
                }
              : step,
          ),
        }),
      )
      outreach.allPutOutCheck = vi.fn(
        (...args: [string, string, string | null, number[]]) =>
          Promise.resolve(
            args[2] === null && args[3].every((id) => id === 501),
          ),
      )
      const contrast = {
        audience: 'Owners outside the flood blocks',
        count: 6_000,
        channel: 'text' as const,
        message:
          'this is Bryan Ortiz, your City Council Member. Is it the drains?',
        deepLinkOnly: false,
        stepId: 'define' as const,
        side: 'contrast' as const,
        sampleSize: 400,
        widensOutreachIds: [501],
      }
      const on = buildWithCrm().buildTools(
        panelsOn(42),
      ).present_outreach_proposal
      const off = buildWithCrm().buildTools(baseCtx()).present_outreach_proposal
      if (
        on === undefined ||
        !('execute' in on) ||
        off === undefined ||
        !('execute' in off)
      ) {
        throw new Error('expected executable tools')
      }

      expect(await on.execute(contrast)).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
      expect(await off.execute(contrast)).toHaveProperty(
        'error',
        expect.stringContaining('this same side'),
      )
      // The sent side still widens only over its own sends.
      expect(
        await on.execute({ ...contrast, side: 'main' as const }),
      ).toHaveProperty('error', expect.stringContaining('this same side'))
    })
  })

  describe('behind serve-citizen-panels, reporting back to the people asked', () => {
    const send = {
      outreachId: 77,
      priorityId: 'pri-1',
      priorityTitle: 'Sidewalk repairs on Maple Ave',
      sentOn: '2026-10-05',
      audience:
        'Everyone you texted about Sidewalk repairs on Maple Ave on October 5',
      reached: 240,
      canReach: 236,
      answered: 31,
      themes: [{ title: 'Trip hazards near the school', people: 14 }],
      reportBack: null,
    }
    let listForOffice: ReturnType<typeof vi.fn>

    const withReportBack = (enabled = true) => {
      listForOffice = vi.fn(() => Promise.resolve([send]))
      return new PriorityFlowHandler(
        store,
        context,
        outreach,
        priorityStatus,
        { voters: [], constituents: [] },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)) } as never,
        { listForOffice } as unknown as OutreachReportBackService,
      )
    }
    const on = (): PriorityFlowContext => ({
      ...baseCtx(),
      outreachFeedbackEnabled: true,
      reportBacks: [send],
    })
    const card = {
      audience: send.audience,
      count: send.canReach,
      channel: 'text' as const,
      message:
        'this is Bryan Ortiz, your City Council Member. Thanks for answering. ' +
        'Most of you named trip hazards near the school. I will ask for ' +
        'those blocks to be fixed first.',
      deepLinkOnly: false,
      reportBackForOutreachId: send.outreachId,
    }
    const proposal = (handler: PriorityFlowHandler) => {
      const tool = handler.buildTools(on()).present_outreach_proposal
      if (tool === undefined || !('execute' in tool)) {
        throw new Error('expected an executable tool')
      }
      return tool
    }

    it('reads the sends whose replies are in only with the flag on', async () => {
      context.countCivicPanelMembers = vi.fn(() => Promise.resolve(0))
      const ctx = await withReportBack(true).loadContext('c1', USER_ID)
      expect(ctx.reportBacks).toEqual([send])
      expect(listForOffice).toHaveBeenCalledWith(ORG, 'office-1', {
        priorityId: 'pri-1',
      })
      expect(Object.keys(withReportBack().buildTools(on()))).toContain(
        'read_report_back',
      )

      const off = await withReportBack(false).loadContext('c1', USER_ID)
      expect(off.reportBacks).toBeUndefined()
      expect(listForOffice).not.toHaveBeenCalled()
      expect(Object.keys(withReportBack().buildTools(baseCtx()))).not.toContain(
        'read_report_back',
      )
      const prompt = withReportBack().buildSystemPrompt(baseCtx())
      expect(prompt).not.toContain('REPORTING BACK')
      expect(prompt).not.toContain('<report_backs>')
    })

    it('starts on the priority the app names, and walks the official through it', () => {
      const prompt = withReportBack().buildSystemPrompt(on())
      expect(prompt).toContain('REPORTING BACK TO THE PEOPLE YOU ASKED')
      expect(prompt).toContain(REPORT_BACK_MARKER)
      expect(prompt).toContain(
        `outreach:77 — ${send.audience}. 31 people answered across texts, calls and doors. Report back: not sent yet.`,
      )
    })

    it("knows a report back already went out, so it doesn't ask", () => {
      const prompt = withReportBack().buildSystemPrompt({
        ...on(),
        reportBacks: [
          { ...send, reportBack: { outreachId: 90, sentOn: '2026-10-12' } },
        ],
      })
      expect(prompt).toContain('Report back: sent 2026-10-12.')
    })

    it('presents a report back only to the people the send reached', async () => {
      const handler = withReportBack()
      const tool = proposal(handler)

      expect(await tool.execute(card)).toEqual({
        presented: true,
        deepLinkOnly: true,
      })
      expect(listForOffice).toHaveBeenLastCalledWith(ORG, 'office-1', {
        priorityId: 'pri-1',
        outreachId: 77,
      })
      expect(await tool.execute({ ...card, count: 240 })).toHaveProperty(
        'error',
        expect.stringContaining('count to 236'),
      )
      expect(
        await tool.execute({ ...card, audience: 'Residents' }),
      ).toHaveProperty('error', expect.stringContaining(send.audience))
      expect(
        await tool.execute({
          ...card,
          audienceFilters: { hasCellPhone: true },
        }),
      ).toHaveProperty('error', expect.stringContaining('audienceFilters'))
      expect(
        await tool.execute({ ...card, civicPanelAsk: true }),
      ).toHaveProperty('error', expect.stringContaining('civicPanelAsk'))
      expect(
        await tool.execute({
          ...card,
          stepId: 'define' as const,
          side: 'main' as const,
        }),
      ).toHaveProperty('error', expect.stringContaining('stepId'))
      expect(
        await tool.execute({ ...card, channel: 'phoneBanking' as const }),
      ).toHaveProperty('error', expect.stringContaining('is a text'))
    })

    it('never offers a second report back, or one too few can get', async () => {
      const handler = withReportBack()
      const tool = proposal(handler)
      listForOffice.mockResolvedValueOnce([
        { ...send, reportBack: { outreachId: 90, sentOn: '2026-10-12' } },
      ])
      expect(await tool.execute(card)).toHaveProperty(
        'error',
        expect.stringContaining('already went out'),
      )
      listForOffice.mockResolvedValueOnce([{ ...send, canReach: 12 }])
      expect(await tool.execute({ ...card, count: 12 })).toHaveProperty(
        'error',
        expect.stringContaining('at least 25'),
      )
      listForOffice.mockResolvedValueOnce([])
      expect(await tool.execute(card)).toHaveProperty(
        'error',
        expect.stringContaining('read_report_back'),
      )
    })

    it('takes no report back with the flag off', () => {
      const tool =
        withReportBack().buildTools(baseCtx()).present_outreach_proposal
      if (tool === undefined || !('inputSchema' in tool) || !tool.inputSchema) {
        throw new Error('expected a schema')
      }
      expect(tool.inputSchema.parse(card)).not.toHaveProperty(
        'reportBackForOutreachId',
      )
    })
  })

  describe('behind serve-citizen-panels, before a good read', () => {
    const thin: PriorityReadStatus = {
      answers: 54,
      needed: 96,
      groupsHeard: 9,
      groupsTotal: 12,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: ['women', 'age65plus'],
    }
    let readStatuses: ReturnType<typeof vi.fn>

    const withReadStatus = (enabled = true) => {
      readStatuses = vi.fn(() => Promise.resolve(new Map([['pri-1', thin]])))
      return new PriorityFlowHandler(
        store,
        context,
        outreach,
        priorityStatus,
        { voters: [], constituents: [] },
        undefined,
        undefined,
        undefined,
        {
          getFilterDimensions: vi.fn(() => []),
          countContacts: vi.fn(),
          countSegment: vi.fn(),
        } as never,
        {} as never,
        undefined,
        { isFeatureEnabled: vi.fn(() => Promise.resolve(enabled)) } as never,
        undefined,
        { readStatuses } as unknown as PriorityResultsService,
      )
    }
    const at = (readStatus: typeof thin): PriorityFlowContext => ({
      ...baseCtx(),
      outreachFeedbackEnabled: true,
      readStatus,
    })

    it('reads the status only with the flag on', async () => {
      context.countCivicPanelMembers = vi.fn(() => Promise.resolve(0))
      const ctx = await withReadStatus(true).loadContext('c1', USER_ID)
      expect(ctx.readStatus).toEqual(thin)
      expect(readStatuses).toHaveBeenCalledWith(ORG, ['pri-1'])

      const off = await withReadStatus(false).loadContext('c1', USER_ID)
      expect(off.readStatus).toBeUndefined()
      expect(readStatuses).not.toHaveBeenCalled()
      const prompt = withReadStatus().buildSystemPrompt(baseCtx())
      expect(prompt).not.toContain('BEFORE A GOOD READ')
      expect(prompt).not.toContain('Groups heard from')
    })

    it('tells the agent where the read stands in <priority>', () => {
      const prompt = withReadStatus().buildSystemPrompt(at(thin))
      expect(prompt).toContain(
        'Groups heard from: 9 of 12. Status: A few groups need more answers. Hear more from: women and people 65 and over. Good read: no.',
      )
      const good = withReadStatus().buildSystemPrompt(
        at({
          answers: 103,
          needed: 96,
          groupsHeard: 12,
          groupsTotal: 12,
          good: true,
          status: 'representative',
          underrepresented: [],
        }),
      )
      expect(good).toContain(
        'Groups heard from: 12 of 12. Status: Every group heard. Hear more from: nobody in particular. Good read: yes.',
      )
    })

    it('holds results back until a good read', () => {
      expect(withReadStatus().buildSystemPrompt(at(thin))).toContain(
        'BEFORE A GOOD READ',
      )
    })

    it('keeps what people said out of read_outreach_feedback until a good read', async () => {
      const send = {
        outreachId: 7,
        name: 'Crossings check',
        audience: 'Residents across the district',
        channel: 'text',
        sentOn: '2026-10-01',
        heardFrom: 240,
        verbatims: [{ text: 'Fix the crosswalk on Main' }],
        verbatimsLeftOut: 0,
        themes: [
          { title: 'Crosswalks', summary: 'Safer crossings', people: 80 },
        ],
      }
      const pooledThemes = vi.fn(() =>
        Promise.resolve([
          { title: 'Crosswalks', summary: 'Safer crossings', people: 80 },
        ]),
      )
      outreach.feedbackFor = vi.fn(() =>
        Promise.resolve([send]),
      ) as unknown as PriorityFlowOutreachService['feedbackFor']
      outreach.pooledThemes =
        pooledThemes as unknown as PriorityFlowOutreachService['pooledThemes']

      const early = withReadStatus().buildTools(at(thin))
        .read_outreach_feedback as unknown as {
        description: string
        execute: (input: object) => Promise<object>
      }
      const held = await early.execute({})
      expect(held).toEqual({
        heldBack: HELD_BACK_NOTE,
        sends: [
          {
            outreachId: 7,
            name: 'Crossings check',
            audience: 'Residents across the district',
            channel: 'text',
            sentOn: '2026-10-01',
            heardFrom: 240,
          },
        ],
      })
      expect(JSON.stringify(held)).not.toContain('Crosswalk')
      expect(pooledThemes).not.toHaveBeenCalled()
      expect(early.description).toContain('you share none')

      const good = withReadStatus().buildTools(
        at({ ...thin, good: true, status: 'representative' }),
      ).read_outreach_feedback as unknown as {
        execute: (input: object) => Promise<object>
      }
      expect(await good.execute({})).toEqual({
        priorityThemes: [
          { title: 'Crosswalks', summary: 'Safer crossings', people: 80 },
        ],
        sends: [send],
      })
    })

    it('treats Get answers as a detour that proposes outreach and returns', () => {
      const prompt = withReadStatus().buildSystemPrompt(at(thin))
      expect(prompt).toContain(GET_ANSWERS_MARKER)
      expect(prompt).toContain('GET ANSWERS (a detour that returns)')
    })

    it('says what is out, and gives no third text', () => {
      const out = withReadStatus().buildSystemPrompt(
        at({ ...thin, checkOut: true }),
      )
      expect(out).toContain('Check out with residents: yes.')
      expect(out).not.toContain('Follow-up text:')
      expect(
        withReadStatus().buildSystemPrompt(
          at({
            ...thin,
            checkOut: true,
            followUp: { scheduledLocalDate: '2026-11-20', texts: 84 },
          }),
        ),
      ).toContain('Do not offer another text for this check.')
      expect(
        withReadStatus().buildSystemPrompt(
          at({ ...thin, checkOut: true, followUpSent: true }),
        ),
      ).toContain('A check gets no third text.')
    })
  })
})
