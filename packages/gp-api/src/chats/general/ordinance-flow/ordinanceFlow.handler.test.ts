import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import {
  ORDINANCE_FLOW_MODELS,
  OrdinanceFlowHandler,
} from './ordinanceFlow.handler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  OrdinanceFlowContext,
  OrdinanceFlowContextService,
} from './services/ordinanceFlowContext.service'
import { OrdinanceFlowToolsService } from './services/ordinanceFlowTools.service'
import { OrdinanceFlowFetchService } from './services/ordinanceFlowFetch.service'

const USER_ID = 7
const ORG = 'eo-123'

const ANCHOR = {
  resourceType: 'ordinance' as const,
  resourceId: 'ord-1',
  url: 'https://goodparty.org/ordinances/ord-1',
  snapshot: { title: 'Noise ordinance', summary: 'Limit late-night noise.' },
  step: 'clarify' as const,
}

const anchorFor = (step: string) => ({ ...ANCHOR, step })

const baseCtx = (): OrdinanceFlowContext => ({
  conversationId: 'c1',
  ordinanceId: 'ord-1',
  electedOfficeId: 'office-1',
  step: 'clarify',
  organizationSlug: ORG,
  officeTitle: 'City Council Member',
  // The context service leaves this null; loadContext fills it from the
  // district resolver (see the jurisdiction tests below).
  jurisdiction: null,
  seedType: 'new',
  issueSlug: null,
  goalText: 'Reduce late-night construction noise',
  clarifyAnswers: [],
  authority: null,
  comparables: null,
  scratchpad: null,
})

describe('OrdinanceFlowHandler', () => {
  let store: GeneralChatStoreService
  let context: OrdinanceFlowContextService
  let tools: OrdinanceFlowToolsService
  let fetchService: OrdinanceFlowFetchService
  let features: { isFeatureEnabled: ReturnType<typeof vi.fn> }

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
      assertOrdinanceOwnership: vi.fn(() => Promise.resolve()),
    } as unknown as OrdinanceFlowContextService
    tools = {} as unknown as OrdinanceFlowToolsService
    fetchService = {} as unknown as OrdinanceFlowFetchService
    features = { isFeatureEnabled: vi.fn(() => Promise.resolve(true)) }
  })

  const build = (districtResolver?: {
    resolveByOrgSlug: ReturnType<typeof vi.fn>
  }) =>
    new OrdinanceFlowHandler(
      store,
      context,
      tools,
      fetchService,
      features as never,
      districtResolver as never,
    )

  it('is a sensitive, Anthropic-only scope', () => {
    const handler = build()
    expect(handler.scope).toBe(ChatScope.ordinance_flow)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...ORDINANCE_FLOW_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)
  })

  it('creates a conversation when none exists for that (ordinance, step)', async () => {
    const result = await build().resolveConversation(
      {
        scope: ChatScope.ordinance_flow,
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
        scope: ChatScope.ordinance_flow,
        anchor: ANCHOR,
        title: 'Noise ordinance',
      }),
    )
  })

  it('will not create a conversation for an ordinance the caller does not own', async () => {
    context.assertOrdinanceOwnership = vi.fn(() =>
      Promise.reject(new NotFoundException('Ordinance not found')),
    ) as never
    await expect(
      build().resolveConversation(
        {
          scope: ChatScope.ordinance_flow,
          organizationSlug: ORG,
          anchor: ANCHOR,
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(store.createScopedConversation).not.toHaveBeenCalled()
  })

  it('rejects the scope when the serve-ordinances flag is off', async () => {
    features.isFeatureEnabled = vi.fn(() => Promise.resolve(false))
    await expect(
      build().resolveConversation(
        {
          scope: ChatScope.ordinance_flow,
          organizationSlug: ORG,
          anchor: ANCHOR,
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(store.findByAnchorResource).not.toHaveBeenCalled()
  })

  it('resumes the existing conversation for the same step', async () => {
    store.findByAnchorResource = vi.fn(() =>
      Promise.resolve([{ id: 'existing', anchor: anchorFor('clarify') }]),
    ) as never
    const result = await build().resolveConversation(
      {
        scope: ChatScope.ordinance_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'existing', created: false })
    expect(store.createScopedConversation).not.toHaveBeenCalled()
  })

  it('creates a new conversation for a different step of the same ordinance', async () => {
    store.findByAnchorResource = vi.fn(() =>
      Promise.resolve([
        { id: 'authority-conv', anchor: anchorFor('authority') },
      ]),
    ) as never
    const result = await build().resolveConversation(
      {
        scope: ChatScope.ordinance_flow,
        organizationSlug: ORG,
        anchor: ANCHOR,
      },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'fresh', created: true })
    expect(store.createScopedConversation).toHaveBeenCalled()
  })

  it('rejects a request without an ordinance anchor', async () => {
    await expect(
      build().resolveConversation(
        { scope: ChatScope.ordinance_flow, organizationSlug: ORG },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('builds the clarify tool set on the clarify step', () => {
    const handler = build()
    const names = Object.keys(handler.buildTools(baseCtx())).sort()
    expect(names).toEqual([
      'ask_clarify_question',
      'get_code_source',
      'offer_next_step',
      'read_ordinance',
      'save_answer',
      'save_note',
      'save_synthesis',
      'web_search',
    ])
  })

  it('builds the research tool set on the current_law step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'current_law' }),
    ).sort()
    expect(names).toEqual([
      'fetch_url',
      'get_code_source',
      'offer_next_step',
      'read_ordinance',
      'save_existing_law',
      'save_note',
      'web_search',
    ])
  })

  it('omits the clarify tools on non-clarify steps but keeps offer_next_step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'authority' }),
    )
    expect(names).not.toContain('ask_clarify_question')
    expect(names).not.toContain('save_answer')
    expect(names).not.toContain('fetch_url')
    expect(names).not.toContain('save_existing_law')
    expect(names).toContain('read_ordinance')
    expect(names).toContain('offer_next_step')
  })

  it('offers no next step on the final (draft) step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'draft' }),
    )
    expect(names).not.toContain('offer_next_step')
  })

  it('raises maxSteps above the default so a research turn can finish', () => {
    expect(build().maxSteps).toBe(8)
  })

  it('builds a system prompt grounded in the ordinance context', async () => {
    const handler = build()
    const ctx = await handler.loadContext('c1', USER_ID)
    const prompt = handler.buildSystemPrompt(ctx)
    expect(prompt).toContain('legislative drafting assistant')
    expect(prompt).toContain('City Council Member')
    expect(prompt).toContain('Reduce late-night construction noise')
  })

  it('fills jurisdiction from the district resolver, keyed by org slug', async () => {
    const resolveByOrgSlug = vi.fn(() =>
      Promise.resolve({ l2DistrictName: 'Ward 3', state: 'NC' }),
    )
    const ctx = await build({ resolveByOrgSlug }).loadContext('c1', USER_ID)
    expect(resolveByOrgSlug).toHaveBeenCalledWith(ORG)
    expect(ctx.jurisdiction).toBe('Ward 3, NC')
  })

  it('leaves jurisdiction null when the resolver finds nothing', async () => {
    const resolveByOrgSlug = vi.fn(() => Promise.resolve(null))
    const ctx = await build({ resolveByOrgSlug }).loadContext('c1', USER_ID)
    expect(ctx.jurisdiction).toBeNull()
  })
})
