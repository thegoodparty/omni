import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseISO } from 'date-fns'
import { z } from 'zod'
import { ChatMessageRole } from '@/generated/prisma'
import { KNOWN_PATTERNS } from '@/caseScout/caseScout.prompts'
import type { Message } from '@/caseScout/util/sessions.util'

export const FIXTURES_DIR = path.join(__dirname, 'fixtures')

export const CONVERSATION_PREFIX = 'bench-'

export const CATEGORIES = [
  'known_pattern',
  'good',
  'borderline',
  'planted_pii',
  'duplicate',
  'uncovered_agent',
] as const

const FixtureToolCallSchema = z.strictObject({
  tool: z.string().min(1),
  input: z.union([z.record(z.string(), z.json()), z.string()]),
})

const FixtureMessageSchema = z.strictObject({
  // A fixture timestamp carries its UTC offset, as a stored one does.
  at: z.iso.datetime({ offset: true }),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  tool_calls: z.array(FixtureToolCallSchema).default([]),
})

const ExpectationSchema = z.strictObject({
  should_draft: z.boolean(),
  pattern: z.enum(KNOWN_PATTERNS).nullable().default(null),
  drop_ok: z.boolean().default(false),
  covered_by: z.string().nullable().default(null),
  also_pass_if_covered_by: z.array(z.string()).default([]),
  scored: z.boolean().default(true),
})
export type Expectation = z.infer<typeof ExpectationSchema>

export const BenchFixtureSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    agent: z.string().min(1),
    category: z.enum(CATEGORIES),
    summary: z.string().min(1),
    notes: z.string().default(''),
    expect: ExpectationSchema,
    planted_pii: z.array(z.string()).default([]),
    denylist: z.array(z.string()).default([]),
    messages: z.array(FixtureMessageSchema).min(1),
  })
  .superRefine((fixture, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (
      fixture.category === 'planted_pii' &&
      fixture.planted_pii.length === 0
    ) {
      issue('a planted_pii fixture must list the PII it plants')
    }
    if (fixture.category !== 'planted_pii' && fixture.planted_pii.length > 0) {
      issue('only a planted_pii fixture plants PII')
    }
    if (fixture.expect.drop_ok && !fixture.expect.should_draft) {
      issue('drop_ok only means something when should_draft is true')
    }
    if (fixture.expect.covered_by !== null && fixture.expect.should_draft) {
      issue('a fixture with covered_by must not also expect a draft')
    }
    if (fixture.messages[0]?.role !== 'user') {
      issue('a fixture opens on a user turn')
    }
  })
export type BenchFixture = z.infer<typeof BenchFixtureSchema>

export const conversationIdOf = (fixture: BenchFixture): string =>
  `${CONVERSATION_PREFIX}${fixture.id}`

export const loadFixtures = (dir: string = FIXTURES_DIR): BenchFixture[] => {
  const fixtures = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = BenchFixtureSchema.safeParse(
        JSON.parse(readFileSync(path.join(dir, name), 'utf8')),
      )
      if (!parsed.success) {
        throw new Error(
          `${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data
    })
  const ids = fixtures.map((fixture) => fixture.id)
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  if (duplicates.length > 0) {
    throw new Error(`duplicate fixture ids: ${duplicates.join(', ')}`)
  }
  return fixtures
}

// The shape caseScoutMessages.service.ts hands the pipeline, so a fixture
// reaches session splitting the way a stored chat does: a tool call's input
// is its stored JSON payload, stringified.
export const fixtureMessages = (fixtures: BenchFixture[]): Message[] =>
  fixtures.flatMap((fixture) =>
    fixture.messages.map((message, index) => ({
      conversationId: conversationIdOf(fixture),
      scope: fixture.agent,
      messageId: `${fixture.id}-m${String(index + 1).padStart(2, '0')}`,
      role:
        message.role === 'user'
          ? ChatMessageRole.user
          : ChatMessageRole.assistant,
      content: message.content,
      createdAt: parseISO(message.at),
      toolCalls: message.tool_calls.map((call) => ({
        tool: call.tool,
        input: JSON.stringify(call.input),
      })),
      isInternal: false,
      denylist: [...fixture.denylist],
    })),
  )
