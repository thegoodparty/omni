import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../generated/prisma'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type {
  ChatStreamService,
  StreamArgs,
} from '@/chats/services/chatStream.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { BriefingSchema } from './types/briefing.schema'
import { HENDERSONVILLE_FIXTURE } from './evals/fixtures/hendersonvilleBriefing.fixture'
import { BriefingChatsService } from './services/briefing-chats.service'
import type { BriefingContextService } from './services/briefingContext.service'
import type { BriefingNotesService } from './services/briefingNotes.service'
import type { DistrictResolverService } from './services/districtResolver.service'
import { extractHighlight } from './services/extractHighlight'
import {
  buildSystemPrompt,
  todayInTimezone,
} from './services/systemPromptBuilder'

// Parity guard for moving briefing chat onto BriefingAnnotationHandler. Every
// tool-gating input is crossed, and for each the live send path must hand the
// stream the tool list the pre-migration service registered (in its order) and
// a prompt byte-identical to the pure builder given that list. The registry's
// conversation-keyed entry must then render exactly what the send path did.

const USER_ID = 42
const FILTERS = [
  { column: 'state_postal_code', value: 'NC' },
  { column: 'City', value: 'Hendersonville' },
]

const JSON_ARTIFACT = JSON.stringify(
  BriefingSchema.parse({
    version: '1.0',
    generatedAt: '2026-05-01T00:00:00Z',
    generationModel: 'test-model',
    meeting: {
      citySlug: 'springfield',
      cityName: 'Springfield',
      state: 'OR',
      body: 'City Council',
      date: '2026-06-01',
      time: '6:30 PM',
      title: 'Regular Council Meeting',
      readTime: '8 min',
      sourceUrl: 'https://example.com/agenda.pdf',
      sourceType: 'agenda packet',
    },
    executiveSummary: {
      headline: 'Headline here',
      subheadline: 'Sub',
      priorityItemCount: 0,
      totalAgendaItems: 0,
    },
    priorityIssues: [],
    fullAgenda: [],
    fullAgendaSummary: 'summary',
    constituentData: {
      available: false,
      voterCount: null,
      topIssues: [],
      ideology: null,
    },
    footer: { preparedBy: 'GP', contactNote: 'contact' },
  }),
)

const ARTIFACTS: Array<[string, string, Annotation]> = [
  [
    'markdown, top-level',
    HENDERSONVILLE_FIXTURE.artifactContent,
    HENDERSONVILLE_FIXTURE.annotation,
  ],
  [
    'briefing JSON, anchored',
    JSON_ARTIFACT,
    {
      ...HENDERSONVILLE_FIXTURE.annotation,
      jsonPath: '/executiveSummary/headline',
      start: 0,
      end: 8,
    },
  ],
]

// none: neither dep wired; the other three wire one or both.
const DISTRICT = [
  'none',
  'no-provider',
  'no-resolver',
  'resolves-null',
  'resolves',
] as const
type District = (typeof DISTRICT)[number]

// The pre-migration service's registration order and gates.
const expectedTools = (
  key: boolean,
  district: District,
  notes: number,
): string[] => [
  'get_artifacts',
  ...(key ? ['web_search'] : []),
  ...(district === 'resolves'
    ? ['district_insights', 'list_district_topics']
    : []),
  ...(notes > 0 ? ['get_my_notes'] : []),
]

const CASES = ARTIFACTS.flatMap(([label, content, annotation]) =>
  [true, false].flatMap((key) =>
    DISTRICT.flatMap((district) =>
      [0, 2].map(
        (notes) => [label, key, district, notes, content, annotation] as const,
      ),
    ),
  ),
)

describe('briefing chat prompt and tool parity', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it.each(CASES)(
    '%s, key=%s, district=%s, notes=%s',
    async (_label, key, district, notes, artifactContent, annotation) => {
      if (key) process.env.ANTHROPIC_API_KEY = 'test-key'
      else delete process.env.ANTHROPIC_API_KEY

      const { briefing, user, office } = HENDERSONVILLE_FIXTURE
      const loaded = { annotation, briefing, artifactContent, user, office }
      // Each fake answers only for the right caller and key, so a path that
      // looked something up under the wrong id would render a different turn.
      const only = (ok: boolean) =>
        ok ? Promise.resolve(loaded) : Promise.reject(new Error('wrong key'))
      const briefingContext = {
        loadContext: vi.fn((annotationId: string, userId: number) =>
          only(annotationId === annotation.id && userId === USER_ID),
        ),
        loadContextByConversation: vi.fn(
          (conversationId: string, userId: number) =>
            only(
              conversationId === annotation.chatConversationId &&
                userId === USER_ID,
            ),
        ),
      } as unknown as BriefingContextService
      const notesService = {
        countNotesForUser: vi.fn(
          (args: { userId: number; briefingId: string }) =>
            Promise.resolve(
              args.userId === USER_ID && args.briefingId === briefing.id
                ? notes
                : 0,
            ),
        ),
        loadNotesForChat: vi.fn(() => Promise.resolve([])),
      } as unknown as BriefingNotesService
      const databricks =
        district === 'none' || district === 'no-provider'
          ? undefined
          : ({
              query: vi.fn(() => Promise.resolve({ columns: [], rows: [] })),
            } as unknown as DatabricksProvider)
      const resolveByUserId = vi.fn(() =>
        Promise.resolve(
          district === 'resolves-null'
            ? null
            : {
                state: 'NC',
                l2DistrictType: 'City',
                l2DistrictName: 'Hendersonville',
                level: null,
              },
        ),
      )
      const resolver =
        district === 'none' || district === 'no-resolver'
          ? undefined
          : ({
              resolveByUserId,
              toMandatoryFilters: vi.fn(() => FILTERS),
            } as unknown as DistrictResolverService)

      let streamed: StreamArgs | undefined
      const chatStream = {
        stream: (args: StreamArgs) => {
          streamed = args
          return {
            [Symbol.asyncIterator]: async function* () {
              yield { type: 'done' } as const
            },
          }
        },
      } as unknown as ChatStreamService
      const svc = new BriefingChatsService(
        briefingContext,
        {} as ChatStoreService,
        chatStream,
        notesService,
        databricks,
        resolver,
      )

      for await (const _ of svc.sendMessage({
        annotationId: annotation.id,
        userId: USER_ID,
        userMessage: 'hi',
      }))
        void _

      const tools = expectedTools(key, district, notes)
      const parsed = BriefingSchema.safeParse(
        (() => {
          try {
            return JSON.parse(artifactContent) as unknown
          } catch {
            return null
          }
        })(),
      )
      const expectedPrompt = buildSystemPrompt({
        annotation,
        briefing,
        artifactContent,
        today: todayInTimezone(briefing.meetingTimezone),
        availableToolNames: tools,
        notesCount: notes,
        user,
        office,
        highlight: extractHighlight(artifactContent, annotation),
        parsed: parsed.success ? parsed.data : null,
      })

      expect(streamed).toBeDefined()
      expect(Object.keys(streamed!.tools)).toEqual(tools)
      expect(streamed!.systemPrompt).toBe(expectedPrompt)
      expect(streamed!.conversationId).toBe(annotation.chatConversationId)
      expect(streamed!.models).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7'])
      expect(streamed!.traceName).toBe('briefing-chat-stream')
      expect(streamed).not.toHaveProperty('scope')
      // District scoping stays keyed on the caller's user id.
      if (databricks && resolver) {
        expect(resolveByUserId).toHaveBeenCalledWith(USER_ID)
      } else {
        expect(resolveByUserId).not.toHaveBeenCalled()
      }

      // The registry entry, keyed on the conversation, renders the same turn.
      const ctx = await svc.handler.loadContext(
        annotation.chatConversationId!,
        USER_ID,
      )
      expect(svc.handler.buildSystemPrompt(ctx)).toBe(expectedPrompt)
      expect(Object.keys(svc.handler.buildTools(ctx))).toEqual(tools)
    },
  )
})
