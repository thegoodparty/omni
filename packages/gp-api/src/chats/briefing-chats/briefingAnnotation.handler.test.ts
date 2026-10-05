import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ChatScope } from '../../generated/prisma'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  BriefingAnnotationHandler,
  BriefingChatContext,
  BRIEFING_CHAT_MODELS,
} from './briefingAnnotation.handler'
import {
  BriefingContextResult,
  BriefingContextService,
} from './services/briefingContext.service'
import type { BriefingNotesService } from './services/briefingNotes.service'
import type { DistrictResolverService } from './services/districtResolver.service'
import {
  buildSystemPrompt,
  todayInTimezone,
} from './services/systemPromptBuilder'
import { HENDERSONVILLE_FIXTURE } from './evals/fixtures/hendersonvilleBriefing.fixture'

const USER_ID = 42
const CONVERSATION_ID = 'conv-hville-1'
const ORG_SLUG = 'org-hendersonville'

const HENDERSONVILLE_FILTERS = [
  { column: 'state_postal_code', value: 'NC' },
  { column: 'City', value: 'Hendersonville' },
]

const loadedContext = (): BriefingContextResult =>
  ({
    annotation: HENDERSONVILLE_FIXTURE.annotation,
    briefing: HENDERSONVILLE_FIXTURE.briefing,
    artifactContent: HENDERSONVILLE_FIXTURE.artifactContent,
    user: HENDERSONVILLE_FIXTURE.user,
    office: HENDERSONVILLE_FIXTURE.office,
    organizationSlug: ORG_SLUG,
  }) as BriefingContextResult

// The same context the fixture describes, so the handler's prompt mapping can
// be diffed against the pure builder called with the fixture directly.
const fixtureContext = (): BriefingChatContext => ({
  conversationId: CONVERSATION_ID,
  userId: USER_ID,
  annotation: HENDERSONVILLE_FIXTURE.annotation,
  briefing: HENDERSONVILLE_FIXTURE.briefing,
  artifactContent: HENDERSONVILLE_FIXTURE.artifactContent,
  user: HENDERSONVILLE_FIXTURE.user,
  office: HENDERSONVILLE_FIXTURE.office,
  parsed: HENDERSONVILLE_FIXTURE.parsed,
  today: HENDERSONVILLE_FIXTURE.today,
  highlight: HENDERSONVILLE_FIXTURE.highlight,
  notesCount: HENDERSONVILLE_FIXTURE.notesCount,
  districtFilters: HENDERSONVILLE_FILTERS,
})

class FakeBriefingContext {
  loadContext = vi.fn(() => Promise.resolve(loadedContext()))
  loadContextByConversation = vi.fn(() => Promise.resolve(loadedContext()))

  asService(): BriefingContextService {
    return this as unknown as BriefingContextService
  }
}

class FakeBriefingNotes {
  countNotesForUser = vi.fn(() => Promise.resolve(0))
  loadNotesForChat = vi.fn(() => Promise.resolve([]))

  asService(): BriefingNotesService {
    return this as unknown as BriefingNotesService
  }
}

const fakeDatabricks = (): DatabricksProvider =>
  ({
    query: vi.fn(() => Promise.resolve({ columns: [], rows: [] })),
  }) as unknown as DatabricksProvider

const fakeResolver = () =>
  ({
    resolveByOrgSlug: vi.fn(() =>
      Promise.resolve({
        state: 'NC',
        l2DistrictType: 'City',
        l2DistrictName: 'Hendersonville',
        level: null,
      }),
    ),
    toMandatoryFilters: vi.fn(() => HENDERSONVILLE_FILTERS),
  }) as unknown as DistrictResolverService

describe('BriefingAnnotationHandler', () => {
  let briefingContext: FakeBriefingContext
  let notes: FakeBriefingNotes

  // web_search is gated on the Anthropic key (the scope is Claude-only).
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey
  })

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    briefingContext = new FakeBriefingContext()
    notes = new FakeBriefingNotes()
  })

  const buildHandler = (
    databricks?: DatabricksProvider,
    districtResolver?: DistrictResolverService,
  ): BriefingAnnotationHandler =>
    new BriefingAnnotationHandler(
      briefingContext.asService(),
      notes.asService(),
      databricks,
      districtResolver,
    )

  it('declares the sensitive briefing scope on an Anthropic-only chain', () => {
    const handler = buildHandler()
    expect(handler.scope).toBe(ChatScope.briefing_annotation)
    expect(handler.isSensitive).toBe(true)
    expect(handler.models).toEqual([...BRIEFING_CHAT_MODELS])
    expect(handler.models.every((m) => m.startsWith('claude'))).toBe(true)
    // Braintrust filters key on this; the registry default would rename it.
    expect(handler.traceName).toBe('briefing-chat-stream')
  })

  it('renders a prompt byte-identical to the pure builder on the fixture', () => {
    const handler = buildHandler(fakeDatabricks())
    const ctx = fixtureContext()

    expect(Object.keys(handler.buildTools(ctx))).toEqual(
      HENDERSONVILLE_FIXTURE.availableToolNames,
    )
    expect(handler.buildSystemPrompt(ctx)).toBe(
      buildSystemPrompt(HENDERSONVILLE_FIXTURE),
    )
  })

  it('resolves the annotation from the conversation id', async () => {
    const handler = buildHandler()
    const ctx = await handler.loadContext(CONVERSATION_ID, USER_ID)

    expect(briefingContext.loadContextByConversation).toHaveBeenCalledWith(
      CONVERSATION_ID,
      USER_ID,
    )
    expect(ctx.conversationId).toBe(CONVERSATION_ID)
    expect(ctx.userId).toBe(USER_ID)
    expect(ctx.today).toBe(
      todayInTimezone(HENDERSONVILLE_FIXTURE.briefing.meetingTimezone),
    )
    // The Hendersonville artifact is markdown, not briefing JSON.
    expect(ctx.parsed).toBeNull()
    expect(ctx.notesCount).toBe(0)
    expect(ctx.districtFilters).toBeNull()
  })

  it('loads the same context from an annotation id', async () => {
    const handler = buildHandler()
    const ctx = await handler.loadContextForAnnotation('ann-hville-1', USER_ID)

    expect(briefingContext.loadContext).toHaveBeenCalledWith(
      'ann-hville-1',
      USER_ID,
    )
    expect(ctx.conversationId).toBe(CONVERSATION_ID)
  })

  it('rejects an annotation with no conversation', async () => {
    briefingContext.loadContext.mockResolvedValueOnce({
      ...loadedContext(),
      annotation: {
        ...HENDERSONVILLE_FIXTURE.annotation,
        chatConversationId: null,
      },
    } as BriefingContextResult)

    await expect(
      handlerLoad(buildHandler(), 'ann-hville-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('resolves district filters only with a warehouse provider', async () => {
    const resolver = fakeResolver()
    const withProvider = await buildHandler(
      fakeDatabricks(),
      resolver,
    ).loadContext(CONVERSATION_ID, USER_ID)
    expect(resolver.resolveByOrgSlug).toHaveBeenCalledWith(ORG_SLUG)
    expect(withProvider.districtFilters).toEqual(HENDERSONVILLE_FILTERS)
    expect(
      Object.keys(buildHandler(fakeDatabricks()).buildTools(withProvider)),
    ).toEqual([
      'get_artifacts',
      'web_search',
      'district_insights',
      'list_district_topics',
    ])

    const resolverOnly = fakeResolver()
    const withoutProvider = await buildHandler(
      undefined,
      resolverOnly,
    ).loadContext(CONVERSATION_ID, USER_ID)
    expect(resolverOnly.resolveByOrgSlug).not.toHaveBeenCalled()
    expect(withoutProvider.districtFilters).toBeNull()
  })

  describe('today', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // 02:00 UTC on May 15 is still the evening of May 14 in New York, so a
    // date taken in UTC (or the server's zone) would be a day ahead of the
    // meeting's local calendar.
    it("is the meeting timezone's calendar date, not UTC's", async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-05-15T02:00:00Z'))
      expect(HENDERSONVILLE_FIXTURE.briefing.meetingTimezone).toBe(
        'America/New_York',
      )

      const ctx = await buildHandler().loadContext(CONVERSATION_ID, USER_ID)

      expect(ctx.today).toBe('2026-05-14')
    })
  })

  it('offers no district tools without a warehouse provider', () => {
    // Filters present, provider absent: the provider gate alone must hold.
    const tools = buildHandler().buildTools(fixtureContext())
    expect(tools).not.toHaveProperty('district_insights')
    expect(tools).not.toHaveProperty('list_district_topics')
  })

  it('registers get_my_notes only when the user has notes', async () => {
    notes.countNotesForUser.mockResolvedValueOnce(3)
    const handler = buildHandler()
    const ctx = await handler.loadContext(CONVERSATION_ID, USER_ID)

    expect(ctx.notesCount).toBe(3)
    expect(handler.buildTools(ctx).get_my_notes).toBeDefined()
    expect(notes.loadNotesForChat).not.toHaveBeenCalled()
  })

  // Briefing conversations are created with their annotation in one
  // transaction, so the registry's generic create path must not run.
  it('refuses to create a conversation through the generic path', async () => {
    await expect(buildHandler().resolveConversation()).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})

const handlerLoad = (
  handler: BriefingAnnotationHandler,
  annotationId: string,
): Promise<BriefingChatContext> =>
  handler.loadContextForAnnotation(annotationId, USER_ID)
