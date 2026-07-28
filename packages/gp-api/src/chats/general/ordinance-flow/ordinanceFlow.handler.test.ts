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
import { OrdinanceFlowSearchService } from './services/ordinanceFlowSearch.service'

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
  officeLevel: null,
  // The context service fills this from the verified code record (or leaves
  // it null); loadContext overrides it with the district resolver when that
  // resolves (see the jurisdiction tests below).
  jurisdiction: null,
  seedType: 'new',
  issueSlug: null,
  goalText: 'Reduce late-night construction noise',
  sourceLink: null,
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
  let searchService: OrdinanceFlowSearchService
  let features: { isFeatureEnabled: ReturnType<typeof vi.fn> }

  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  const originalBraveKey = process.env.BRAVE_API_KEY
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    process.env.BRAVE_API_KEY = originalBraveKey
  })

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.BRAVE_API_KEY = 'test-brave-key'
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
    searchService = {} as unknown as OrdinanceFlowSearchService
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
      searchService,
      features as never,
      districtResolver as never,
    )

  it('gives the draft step the clarify widget for its rare question', () => {
    const names = Object.keys(
      build().buildTools({ ...baseCtx(), step: 'draft' }),
    )
    expect(names).toContain('ask_clarify_question')
    expect(names).toContain('present_draft')
    expect(names).not.toContain('save_synthesis')
  })

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

  it('gives the review step its own conversation, apart from the flow draft', async () => {
    store.findByAnchorResource = vi.fn(() =>
      Promise.resolve([{ id: 'flow-draft', anchor: anchorFor('draft') }]),
    ) as never
    const result = await build().resolveConversation(
      {
        scope: ChatScope.ordinance_flow,
        organizationSlug: ORG,
        anchor: { ...ANCHOR, step: 'review' as const },
      },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'fresh', created: true })
    expect(store.createScopedConversation).toHaveBeenCalled()
  })

  it('resumes the review conversation without matching the flow draft', async () => {
    store.findByAnchorResource = vi.fn(() =>
      Promise.resolve([
        { id: 'flow-draft', anchor: anchorFor('draft') },
        { id: 'review-conv', anchor: anchorFor('review') },
      ]),
    ) as never
    const result = await build().resolveConversation(
      {
        scope: ChatScope.ordinance_flow,
        organizationSlug: ORG,
        anchor: { ...ANCHOR, step: 'review' as const },
      },
      USER_ID,
    )
    expect(result).toEqual({ conversationId: 'review-conv', created: false })
    expect(store.createScopedConversation).not.toHaveBeenCalled()
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
      'brave_search',
      'fetch_url',
      'get_code_source',
      'offer_next_step',
      'present_current_law_summary',
      'present_legislative_history',
      'read_ordinance',
      'save_existing_law',
      'save_note',
      'web_search',
    ])
  })

  it('gates brave_search to current_law and to the BRAVE_API_KEY', () => {
    const handler = build()
    const currentLaw = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'current_law' }),
    )
    expect(currentLaw).toContain('brave_search')
    // Only the current_law step reads live pages, so only it gets brave_search.
    expect(Object.keys(handler.buildTools(baseCtx()))).not.toContain(
      'brave_search',
    )
    expect(
      Object.keys(handler.buildTools({ ...baseCtx(), step: 'comparables' })),
    ).not.toContain('brave_search')

    delete process.env.BRAVE_API_KEY
    expect(
      Object.keys(handler.buildTools({ ...baseCtx(), step: 'current_law' })),
    ).not.toContain('brave_search')
  })

  it('offers the authority finding tool on the authority step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'authority' }),
    ).sort()
    expect(names).toEqual([
      'get_code_source',
      'offer_next_step',
      'present_authority_finding',
      'read_ordinance',
      'save_note',
      'web_search',
    ])
  })

  it('offers the comparables tool on the comparables step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'comparables' }),
    ).sort()
    expect(names).toEqual([
      'get_code_source',
      'offer_next_step',
      'present_comparables',
      'read_ordinance',
      'save_note',
      'web_search',
    ])
  })

  it('builds the review tool set: base tools only, no present_draft or offer_next_step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'review' }),
    ).sort()
    expect(names).toEqual([
      'get_code_source',
      'read_ordinance',
      'save_note',
      'web_search',
    ])
    expect(names).not.toContain('present_draft')
    expect(names).not.toContain('offer_next_step')
  })

  it('gates present_* tools to their own step', () => {
    const handler = build()
    const clarify = Object.keys(handler.buildTools(baseCtx()))
    expect(clarify).not.toContain('present_authority_finding')
    expect(clarify).not.toContain('present_comparables')
    const authority = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'authority' }),
    )
    expect(authority).not.toContain('present_comparables')
    expect(authority).not.toContain('present_current_law_summary')
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

  it('offers the draft tool but no next step on the final (draft) step', () => {
    const handler = build()
    const names = Object.keys(
      handler.buildTools({ ...baseCtx(), step: 'draft' }),
    ).sort()
    expect(names).toEqual([
      'ask_clarify_question',
      'get_code_source',
      'present_draft',
      'read_ordinance',
      'save_note',
      'web_search',
    ])
    // The draft is the terminal step, so it never offers a next-step button.
    expect(names).not.toContain('offer_next_step')
  })

  it('raises maxSteps above the default so a research turn can finish', () => {
    expect(build().maxSteps).toBe(30)
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

  it('keeps the code-record jurisdiction when the resolver finds nothing', async () => {
    vi.mocked(context.load).mockResolvedValue({
      ...baseCtx(),
      jurisdiction: 'Hendersonville, NC',
    })
    const resolveByOrgSlug = vi.fn(() => Promise.resolve(null))
    const ctx = await build({ resolveByOrgSlug }).loadContext('c1', USER_ID)
    expect(ctx.jurisdiction).toBe('Hendersonville, NC')
  })

  // The position's level is what tells the prompt a state house member is
  // drafting a bill, not a municipal ordinance — it must survive loadContext.
  it('fills officeLevel from the district resolver position level', async () => {
    const resolveByOrgSlug = vi.fn(() =>
      Promise.resolve({
        l2DistrictName: 'State House District 12',
        state: 'NC',
        level: 'STATE',
      }),
    )
    const ctx = await build({ resolveByOrgSlug }).loadContext('c1', USER_ID)
    expect(ctx.officeLevel).toBe('STATE')
    expect(ctx.jurisdiction).toBe('State House District 12, NC')
  })

  it('leaves officeLevel null when the resolver finds nothing', async () => {
    const resolveByOrgSlug = vi.fn(() => Promise.resolve(null))
    const ctx = await build({ resolveByOrgSlug }).loadContext('c1', USER_ID)
    expect(ctx.officeLevel).toBeNull()
  })
})
