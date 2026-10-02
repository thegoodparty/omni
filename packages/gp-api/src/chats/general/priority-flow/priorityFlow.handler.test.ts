import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  emptyPriorityStatus,
  PROPOSAL_SENT_MARKER,
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
  officialFirstName: 'Bryan',
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
    expect(priorityStatus.buildStatusTool).toHaveBeenCalledWith(
      'pri-1',
      expect.objectContaining({
        offered: expect.any(Function),
        startedAt: expect.any(String),
      }),
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
    expect(names).toContain('list_precincts')
    expect(names).toContain('read_community_issues')
  })

  const buildWithCrm = () =>
    new PriorityFlowHandler(
      store,
      context,
      outreach,
      priorityStatus,
      [],
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

  it('counts a text audience by cell phone and asks options as choices', () => {
    const prompt = buildWithCrm().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('Has Cell Phone for a text')
    expect(prompt).toContain('one option per choice')
  })

  // The list is saved when the official starts the outreach, not by the
  // agent, and the card shows no why, so the agent's message carries it.
  it('counts the check audience without saving it, on one channel, signed', () => {
    const prompt = buildWithCrm().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('Do not save the list.')
    expect(prompt).toContain('audienceFilters')
    expect(prompt).toContain('Pick ONE channel')
    expect(prompt).toContain('Never expect the card to say it.')
    expect(prompt).toContain('signed as the official by first name and office')
    expect(prompt).toContain("Official's first name: Bryan")
  })

  it('puts the options step to them as one multi-select question', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('as one multiSelect ask_clarify_question')
    expect(prompt).toContain('Never list the options in prose')
    expect(prompt).toContain(
      'Set multiSelect when more than one answer can be true',
    )
    expect(prompt).toContain(
      'Leave it off when the answers rule each other out',
    )
  })

  it('takes an answer that picks several options as one problem', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('One problem can show up as several symptoms')
    expect(prompt).toContain('Never tell them to pick just one')
  })

  it('offers a stage-gate check even without the list tools', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('CHECKING A STEP WITH THE PEOPLE IT LANDS ON')
    expect(prompt).toContain('comes back at most 3 times')
    expect(prompt).toContain(
      'Every one of the four gets the offer, plan included',
    )
    expect(prompt).toContain(
      'method: put the chosen method itself to them, not the problem again',
    )
    expect(prompt).toContain(
      'Every check has two sides, and you always offer both',
    )
    expect(prompt).toContain('Never frame them as less important')
    expect(prompt).toContain(
      'do the check in that same turn before any work on the next step',
    )
    expect(prompt).toContain('never counts as constituents agreeing')
    expect(prompt).toContain('never say a check is out')
    expect(prompt).toContain(
      'has been offered a check with the people the plan lands on',
    )
    expect(prompt).not.toContain('HOW TO CHOOSE WHO TO HEAR FROM')
    expect(prompt).not.toContain('BUILD THE CHECK BEFORE YOU OFFER IT')
  })

  it('adds the affectedness method and the list work with the CRM tools', () => {
    const prompt = buildWithCrm().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('HOW TO CHOOSE WHO TO HEAR FROM')
    expect(prompt).toContain('Pick for exposure only')
    expect(prompt).toContain('A district or ward seat is NOT the city')
    expect(prompt).toContain('Never quietly fall back to the whole city')
    expect(prompt).toContain('fewer than about 100 people')
    expect(prompt).toContain('every check also gets the least affected group')
    expect(prompt).toContain(
      'Present it as its own present_outreach_proposal, right after the first',
    )
    expect(prompt).toContain('never filter on it')
    expect(prompt).toContain('BUILD THE CHECK BEFORE YOU OFFER IT')
    expect(prompt).toContain(
      'Present it with present_outreach_proposal, whatever the channel, ' +
        'door knocking included',
    )
    expect(prompt).not.toContain('/dashboard/door-knocking')
    expect(prompt).toContain('present_outside_contact')
    expect(prompt.indexOf('HOW TO CHOOSE WHO TO HEAR FROM')).toBeLessThan(
      prompt.indexOf('BUILD THE CHECK BEFORE YOU OFFER IT'),
    )
  })

  it('sizes a check as a random sample, one per side', () => {
    const prompt = buildWithCrm().buildSystemPrompt(baseCtx())
    expect(prompt).toContain('HOW MANY PEOPLE TO ASK')
    expect(prompt).toContain('100 replies at 2.5% is 4,000 people')
    expect(prompt).toContain('take replyRate from its past texts')
    expect(prompt).toContain('Each side of a check gets its own sample')
    expect(prompt).toContain('Never sample more people than the audience holds')
    expect(prompt).toContain('not by a reply rate')
    expect(prompt).toContain("I'd text 4,000 of the 58,520, picked at random")
    expect(prompt).toContain('Never call it statistically proven')
    expect(prompt).toContain('It is directional')
    expect(prompt.indexOf('BUILD THE CHECK BEFORE YOU OFFER IT')).toBeLessThan(
      prompt.indexOf('HOW MANY PEOPLE TO ASK'),
    )
  })

  it('holds a thin read back from confirming a check, and offers to widen', () => {
    const prompt = build().buildSystemPrompt(baseCtx())
    expect(prompt).not.toContain('HOW MANY PEOPLE TO ASK')
    expect(prompt).toContain('READING WHAT CAME BACK')
    expect(prompt).toContain('Under about 75, the read is thin')
    expect(prompt).toContain('do not record that side confirmed or revised')
    expect(prompt).toContain('widensOutreachIds')
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
      message: 'I am calling for Bryan, your City Council Member.',
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
        'Hi, this is Bryan, your City Council Member. Repairs start soon.',
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
        message: 'this is Bryan, your City Council Member. Is the sidewalk it?',
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
          'Hi, I am calling for Bryan, your City Council Member. Is it the ' +
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
      message: 'I am calling for Bryan, your City Council Member.',
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
      message: 'I am calling for Bryan, your City Council Member.',
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
      message: 'I am calling for Bryan, your City Council Member.',
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
      'Check: out. Who: Renters. Question: Is it the drains? Sent: 2026-09-30T12:00:00Z.',
    )
    expect(prompt).toContain(
      'a side sent from its card is recorded as out on its own',
    )
    expect(prompt).toContain('Never present it again')
    expect(prompt).toContain('say in one line that it is out, once')
    expect(prompt).toContain(`starts with ${PROPOSAL_SENT_MARKER}`)
    expect(prompt).toContain('stepId (the step you just settled) and side main')
    expect(prompt).toContain('with the same stepId and side contrast')
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

  it('tells the agent to ask with the tool rather than in prose', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('Ask it with ask_clarify_question, never in prose')
    expect(prompt).toContain('One question at a time')
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
