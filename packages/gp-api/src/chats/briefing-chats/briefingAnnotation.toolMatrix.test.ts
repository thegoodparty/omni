import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import { buildDistrictInsightsTool } from '@/llm/tools/districtInsights.tool'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { BriefingSchema } from './types/briefing.schema'
import { HENDERSONVILLE_FIXTURE } from './evals/fixtures/hendersonvilleBriefing.fixture'
import { BriefingAnnotationHandler } from './briefingAnnotation.handler'
import type {
  BriefingContextResult,
  BriefingContextService,
} from './services/briefingContext.service'
import type { BriefingNotesService } from './services/briefingNotes.service'
import type { DistrictResolverService } from './services/districtResolver.service'
import { extractHighlight } from './services/extractHighlight'
import {
  buildSystemPrompt,
  todayInTimezone,
} from './services/systemPromptBuilder'

// The tool matrix for briefing chat. Every tool-gating input is crossed, and
// for each the handler must register the same tool list and tool
// configuration the pre-registry service did, with a prompt byte-identical to
// the pure builder given that list.
//
// The baseline (expectedTools, assertToolConfig) is a hand-written SPEC of that
// behavior, not a copy of deleted code. It was checked once against
// origin/main's pre-registry BriefingChatsService (all 40 cases passed there);
// from here on it is the contract.

const USER_ID = 42
const ORG_SLUG = 'org-hendersonville'
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

// none: neither dep wired; the other four wire one or both.
const DISTRICT = [
  'none',
  'no-provider',
  'no-resolver',
  'resolves-null',
  'resolves',
] as const
type District = (typeof DISTRICT)[number]

// The pre-registry service's registration order and gates.
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

const VOTERS_TABLE = 'serve_agent_voters'
const IN_DISTRICT_SQL =
  `SELECT COUNT(*) AS n FROM ${VOTERS_TABLE} ` +
  "WHERE state_postal_code = 'NC' AND City = 'Hendersonville'"
const CALL = { toolCallId: 'matrix', messages: [] }

type Executable = {
  description?: string
  execute: (input: unknown, options: unknown) => Promise<unknown>
}
const executable = (tool: LlmTool | undefined): Executable => {
  expect(tool).toBeDefined()
  expect(tool).toHaveProperty('execute')
  return tool as unknown as Executable
}

// The configuration each registered tool carries, beyond its name: the
// web_search budget, the voter-table allowlist and district filters behind
// district_insights, and the notes loader behind get_my_notes.
const assertToolConfig = async (
  tools: Record<string, LlmTool>,
  deps: {
    key: boolean
    district: District
    notes: number
    databricks: DatabricksProvider | undefined
    notesService: BriefingNotesService
    briefingId: string
    artifactContent: string
  },
): Promise<void> => {
  await expect(
    executable(tools.get_artifacts).execute({}, CALL),
  ).resolves.toBeDefined()

  if (deps.key) {
    expect(tools.web_search).toEqual({
      kind: 'native_web_search',
      maxUses: 5,
    })
  }

  if (deps.district === 'resolves') {
    const insights = executable(tools.district_insights)
    expect(insights.description).toBe(
      buildDistrictInsightsTool({
        provider: deps.databricks!,
        allowedTables: new Set([VOTERS_TABLE]),
        allowedDimensions: new Set(),
        forbiddenColumns: new Set(),
        mandatoryFilters: FILTERS,
        peopleDataset: { base: 'voters' },
      }).description,
    )
    const query = vi.mocked(deps.databricks!.query)
    query.mockClear()
    await insights.execute({ sql: IN_DISTRICT_SQL, rationale: 'r' }, CALL)
    expect(query).toHaveBeenCalledTimes(1)
    // Another table, and the right table without the district's filters,
    // never reach the warehouse.
    await expect(
      insights.execute(
        {
          sql: IN_DISTRICT_SQL.replace(VOTERS_TABLE, 'other_voters'),
          rationale: 'r',
        },
        CALL,
      ),
    ).rejects.toThrow()
    await expect(
      insights.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${VOTERS_TABLE} WHERE state_postal_code = 'NC'`,
          rationale: 'r',
        },
        CALL,
      ),
    ).rejects.toThrow()
    // A row per voter never reaches it either.
    await expect(
      insights.execute(
        {
          sql: IN_DISTRICT_SQL.replace(
            'COUNT(*) AS n',
            'voter_key, COUNT(*) AS n',
          ).concat(' GROUP BY voter_key'),
          rationale: 'r',
        },
        CALL,
      ),
    ).rejects.toThrow(/voter_key/)
    expect(query).toHaveBeenCalledTimes(1)
    expect(executable(tools.list_district_topics)).toBeDefined()
  }

  if (deps.notes > 0) {
    const load = vi.mocked(deps.notesService.loadNotesForChat)
    load.mockClear()
    await executable(tools.get_my_notes).execute({}, CALL)
    expect(load).toHaveBeenCalledWith({
      userId: USER_ID,
      briefingId: deps.briefingId,
      artifactContent: deps.artifactContent,
    })
  }
}

const CASES = ARTIFACTS.flatMap(([label, content, annotation]) =>
  [true, false].flatMap((key) =>
    DISTRICT.flatMap((district) =>
      [0, 2].map(
        (notes) => [label, key, district, notes, content, annotation] as const,
      ),
    ),
  ),
)

describe('briefing chat prompt and tool matrix', () => {
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
      const loaded = {
        annotation,
        briefing,
        artifactContent,
        user,
        office,
        organizationSlug: ORG_SLUG,
        organization: {
          ownerId: 9,
          overrideDistrictId: null,
          positionId: null,
        },
      } as BriefingContextResult

      const briefingContext = {
        // Answers only for the right caller and conversation, so a handler
        // that looked something up under the wrong id would fail here.
        loadContextByConversation: vi.fn(
          (conversationId: string, userId: number) =>
            conversationId === annotation.chatConversationId &&
            userId === USER_ID
              ? Promise.resolve(loaded)
              : Promise.reject(new Error('wrong key')),
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
      const resolveByOrgSlug = vi.fn((slug: string) =>
        Promise.resolve(
          district === 'resolves-null' || slug !== ORG_SLUG
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
              resolveByOrgSlug,
              toMandatoryFilters: vi.fn(() => FILTERS),
            } as unknown as DistrictResolverService)

      const handler = new BriefingAnnotationHandler(
        briefingContext,
        notesService,
        databricks,
        resolver,
      )

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

      const ctx = await handler.loadContext(
        annotation.chatConversationId!,
        USER_ID,
      )
      expect(ctx.conversationId).toBe(annotation.chatConversationId)
      expect(handler.buildSystemPrompt(ctx)).toBe(expectedPrompt)
      const registered = handler.buildTools(ctx)
      expect(Object.keys(registered)).toEqual(tools)
      await assertToolConfig(registered, {
        key,
        district,
        notes,
        databricks,
        notesService,
        briefingId: briefing.id,
        artifactContent,
      })
      expect(handler.models).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7'])
      expect(handler.traceName).toBe('briefing-chat-stream')
      // District scoping is keyed on the briefing's own org, not the user.
      if (databricks && resolver) {
        expect(resolveByOrgSlug).toHaveBeenCalledWith(ORG_SLUG)
      } else {
        expect(resolveByOrgSlug).not.toHaveBeenCalled()
      }
    },
  )
})
