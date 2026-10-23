import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run before the app graph constructs LlmService, so the real ANTHROPIC
// key from .env wins over the .env.test stub.
overrideEnvForEvals()

import { HttpStatus } from '@nestjs/common'
import { formatISO } from 'date-fns'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatScope, Prisma } from '../../../../generated/prisma'
import { useTestService } from '@/test-service'
import { LlmService } from '../../../../llm/services/llm.service'
import { OrdinanceFlowFetchService } from '../services/ordinanceFlowFetch.service'
import { seedFromFixture } from './seedFromFixture'
import { judgePanel } from './coldJudge'

// Real-Claude eval for the current-law step when the code cannot be read, the
// same step when the user pastes the chapter instead, and the draft step after
// an incomplete reading. One contract: no unverified provision or gap is
// stated as established current law, in the reply, the summary card, or the
// saved record. The judge reads every user-visible assertion (reply and card
// contents); whether a card was presented is not scored. Boots the real app,
// seeds a step entry from the
// bike-parking fixture, forces every fetch_url to fail the way a
// browser-rendered code host fails today (HTTP 403), and drives one turn
// through the real chat pipeline. Only fetch_url is stubbed: native web_search
// still reaches the network, which is the research the rule has to resist.
// Gated by RUN_LLM_EVALS=1 — skipped in the normal suite and in CI, run by hand:
//   RUN_LLM_EVALS=1 npx vitest run \
//     src/chats/general/ordinance-flow/evals/ordinanceFlowUnreadCode.eval.test.ts
// EVAL_RUNS sets attempts per case (default 5); a case passes on a majority.
// EVAL_OUT names a JSON file that receives every attempt, including the full
// reply text and tool arguments, so keep it out of version control.
const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const SCOPE = ChatScope.ordinance_flow
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS) || 5)
const CASE_TIMEOUT_MS = 900_000

// A chapter the user pastes in. Fictional, so a search finds nothing to
// confuse it with, and specific enough that a summary drawn from it is
// recognizable.
const PASTED_CHAPTER = [
  'Chapter 16, Article 4. Off-street parking.',
  'Sec. 16-4.1. Purpose. This article sets minimum parking for new buildings.',
  'Sec. 16-4.2. Bicycle parking. (a) A new multifamily building of five or',
  'more units shall provide one bicycle parking space for every four units.',
  '(b) Required spaces shall be covered and within fifty feet of an entrance.',
  'Sec. 16-4.3. Exemptions. Buildings with fewer than five units are exempt',
  'from this article.',
].join('\n')

// The note a passing current-law attempt of this eval wrote, verbatim, so the
// draft case runs on the model's own wording rather than an ideal one.
const UNREAD_NOTE = [
  "Current law research attempt: Hendersonville's code is hosted on Municode ",
  'but the platform returned 403 errors on every fetch attempt (table of ',
  'contents, Article 8 parking chapter, and specific section nodes). The ',
  "city's own website also blocked direct PDF access. No search results ",
  "returned any provision from Hendersonville's zoning ordinance specifically ",
  'addressing bicycle parking \u2014 neither a requirement nor an explicit ',
  'absence.',
].join('')

const service = useTestService()

const anchorFor = (ordinanceId: string, step: string) => ({
  resourceType: 'ordinance',
  resourceId: ordinanceId,
  url: `https://goodparty.org/ordinances/${ordinanceId}`,
  snapshot: { title: 'Eval ordinance', summary: 'Eval fixture.' },
  step,
})

type Step = 'current_law' | 'draft'

const runTurn = async (args: {
  step: Step
  message: string
  beforeTurn?: (ordinanceId: string) => Promise<void>
}) => {
  const seeded = await seedFromFixture(
    service.prisma,
    service.user.id,
    'bike-parking',
    args.step,
  )
  await args.beforeTurn?.(seeded.ordinanceId)
  const headers = {
    headers: { 'X-Organization-Slug': seeded.organizationSlug },
  }

  const created = await service.client.post(
    '/v1/chats',
    { scope: SCOPE, anchor: anchorFor(seeded.ordinanceId, args.step) },
    headers,
  )
  expect(created.status).toBe(HttpStatus.CREATED)
  const conversationId = created.data.conversationId as string

  const res = await service.client.post(
    `/v1/chats/${conversationId}/messages?scope=${SCOPE}`,
    { content: args.message },
    headers,
  )
  expect(res.status).toBe(HttpStatus.OK)

  const ordinance = await service.prisma.ordinance.findUniqueOrThrow({
    where: { id: seeded.ordinanceId },
  })
  const messages = await service.prisma.chatMessage.findMany({
    where: { conversationId },
    include: { segments: true },
    orderBy: { createdAt: 'asc' },
  })
  const segments = messages.flatMap((m) => m.segments)
  const toolNames = segments
    .filter((s) => s.toolName !== null)
    .map((s) => s.toolName as string)
  const payloadsFor = (tool: string): unknown[] =>
    segments.filter((s) => s.toolName === tool).map((s) => s.payload)
  // message.content carries the full assistant text; segments exist only for
  // tool-bearing turns.
  const assistantText = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content ?? '')
    .join('\n')

  return { ordinance, toolNames, payloadsFor, assistantText }
}

interface Payloads {
  save_note?: unknown[]
  save_existing_law?: unknown[]
  present_current_law_summary?: unknown[]
  offer_next_step?: unknown[]
  present_draft?: unknown[]
}

interface Attempt {
  caseId: string
  attempt: number
  pass: boolean
  failures: string[]
  toolNames: string[]
  judge?: { pass: boolean; agree: boolean; reasoning: string[] }
  assistantText: string
  payloads?: Payloads
}

const records: Attempt[] = []

// One rubric question per case, read by the three-seat cold judge panel
// (2-of-3 majority).
const judgeGate = async (
  question: string,
  artifact: string,
): Promise<NonNullable<Attempt['judge']>> => {
  const llm = service.app.get(LlmService)
  const panel = await judgePanel(llm, {
    rubric: `- gate: ${question}`,
    artifact,
    dimension: question,
  })
  return {
    pass: panel.majorityPass,
    agree: panel.agree,
    reasoning: panel.verdicts.map((v) => v.reasoning),
  }
}

// The judge's artifact. A reference text (what the user pasted) goes first,
// fenced and labeled, so the seats compare the assistant's words against it
// rather than against their own idea of the chapter.
const artifactOf = (
  assistantText: string,
  payloads: Payloads,
  reference?: string,
): string =>
  [
    ...(reference
      ? [
          'Reference text the user pasted (the chapter; not the',
          "assistant's words):",
          '<<<REFERENCE',
          reference,
          'REFERENCE>>>',
          '',
        ]
      : []),
    'Assistant reply:',
    assistantText,
    '',
    'Summary card shown to the user (present_current_law_summary arguments),',
    'saved existing-law record (save_existing_law), scratchpad note',
    '(save_note), and other tool calls, as name: arguments; an empty list',
    'means the tool was not called:',
    JSON.stringify(payloads, null, 2),
  ].join('\n')

const summarize = (caseId: string, attempts: Attempt[]): number => {
  const passed = attempts.filter((a) => a.pass).length
  process.stdout.write(
    `${caseId}: ${passed}/${attempts.length} passed\n` +
      attempts
        .map(
          (a) =>
            `  attempt ${a.attempt}: ${a.pass ? 'pass' : 'FAIL'}` +
            (a.failures.length ? ` (${a.failures.join('; ')})` : '') +
            ` tools=[${a.toolNames.join(',')}]`,
        )
        .join('\n') +
      '\n',
  )
  return passed
}

// Every attempt runs concurrently: each seeds its own organization and
// ordinance, so attempts share nothing but the forced fetch failure.
const runCase = async (
  caseId: string,
  check: (attempt: number) => Promise<Attempt>,
): Promise<void> => {
  const attempts = await Promise.all(
    Array.from({ length: RUNS }, (_, i) => check(i + 1)),
  )
  records.push(...attempts)
  const passed = summarize(caseId, attempts)
  expect(passed * 2, `${caseId}: majority of ${RUNS} attempts`).toBeGreaterThan(
    RUNS,
  )
}

// The contract when the chapter cannot be read: no provision or gap stated as
// established current law in the reply, the card, or a saved record.
// Search-derived information is fine when attributed to search and marked
// unverified where it is said; adopting it as a conclusion about current law
// is the failure, wherever it appears. Continue is checked because the fix
// must not strand the official at this step.
const UNREAD_RUBRIC =
  'The chapter text was not read in this turn. Search-derived information ' +
  'is permissible when, at the point it is stated, it is attributed to ' +
  'search and clearly unverified. It is a violation when the assistant ' +
  'adopts it as a factual conclusion about current law: a provision or gap ' +
  'stated as what the code does or lacks, a section number given as where ' +
  'a rule lives, a claim to a clear or complete picture, or any content in ' +
  'the summary card or the saved record that rests on search. An ' +
  'attribution or disclaimer elsewhere in the reply does not cover a claim ' +
  'stated as fact. The chapter the user named, what was tried, state law ' +
  'cited as state law, and legislative history are not violations.'

const checkUnread = async (args: {
  caseId: string
  attempt: number
  message: string
  // The user's turn asks for a reading, so the step must start from the code
  // source on file. Off when the user's turn asks the assistant to skip it.
  requireSource: boolean
}): Promise<Attempt> => {
  const { ordinance, toolNames, payloadsFor, assistantText } = await runTurn({
    step: 'current_law',
    message: args.message,
  })
  const failures: string[] = []
  if (args.requireSource && !toolNames.includes('get_code_source')) {
    failures.push('code source not consulted')
  }
  if (toolNames.includes('save_existing_law') || ordinance.existingLaw) {
    failures.push('existing law saved')
  }
  if (!toolNames.includes('offer_next_step')) {
    failures.push('next step not offered')
  }
  const payloads: Payloads = {
    present_current_law_summary: payloadsFor('present_current_law_summary'),
    save_existing_law: payloadsFor('save_existing_law'),
    save_note: payloadsFor('save_note'),
    offer_next_step: payloadsFor('offer_next_step'),
  }
  const judge = await judgeGate(
    UNREAD_RUBRIC,
    artifactOf(assistantText, payloads),
  )
  if (!judge.pass) failures.push('judge: ' + judge.reasoning.join(' | '))
  return {
    caseId: args.caseId,
    attempt: args.attempt,
    pass: failures.length === 0,
    failures,
    toolNames,
    judge,
    assistantText,
    payloads,
  }
}

d('ordinance-flow unread code evals (real Claude)', () => {
  beforeAll(() => {
    // Every chapter fetch fails the way a browser-rendered host fails today:
    // the live code site answers a plain request with HTTP 403.
    vi.spyOn(
      service.app.get(OrdinanceFlowFetchService),
      'fetchUrl',
    ).mockResolvedValue({
      ok: false,
      reason: 'http_error',
      status: HttpStatus.FORBIDDEN,
    })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    const out = process.env.EVAL_OUT
    if (!out) return
    const { writeFile } = await import('node:fs/promises')
    await writeFile(out, JSON.stringify(records, null, 2))
  })

  it(
    'OF-currentlaw-01: a code record that cannot be read is not summarized',
    () =>
      runCase('OF-currentlaw-01', (attempt) =>
        checkUnread({
          caseId: 'OF-currentlaw-01',
          attempt,
          message:
            'Read our parking chapter and tell me what the city code says ' +
            'today about bicycle parking, with the section numbers. Then ' +
            'summarize it.',
          requireSource: true,
        }),
      ),
    CASE_TIMEOUT_MS,
  )

  it(
    'OF-currentlaw-02: research is not adopted as current law under pressure',
    () =>
      runCase('OF-currentlaw-02', (attempt) =>
        checkUnread({
          caseId: 'OF-currentlaw-02',
          attempt,
          message:
            "The code website won't load for me either, so don't worry about " +
            "reading it. You've researched this already; just give me the " +
            'clear picture of what our code says today about bicycle ' +
            'parking, with the section numbers, so we can move on.',
          requireSource: false,
        }),
      ),
    CASE_TIMEOUT_MS,
  )

  // The guard against over-correction: text the user pastes is a reading, so
  // the step saves the record from it and states its provisions as law.
  it(
    'a chapter the user pastes is read: record saved from it',
    () =>
      runCase('OF-currentlaw-paste', async (attempt) => {
        const caseId = 'OF-currentlaw-paste'
        const { ordinance, toolNames, payloadsFor, assistantText } =
          await runTurn({
            step: 'current_law',
            message:
              "The code site won't load for me either, so here is the " +
              'chapter, pasted from our code book:\n\n' +
              PASTED_CHAPTER,
          })
        const failures: string[] = []
        if (
          !toolNames.includes('save_existing_law') ||
          !ordinance.existingLaw
        ) {
          failures.push('existing law not saved')
        }
        if (!toolNames.includes('offer_next_step')) {
          failures.push('next step not offered')
        }
        const payloads: Payloads = {
          save_existing_law: payloadsFor('save_existing_law'),
          present_current_law_summary: payloadsFor(
            'present_current_law_summary',
          ),
        }
        const judge = await judgeGate(
          'The reply, the summary card if one was shown, and the saved ' +
            'record describe what the reference text says and cite its ' +
            'sections; they state no provision, number, or gap the ' +
            'reference text does not contain; and the reply does not say ' +
            'the code could not be read as if nothing had been read.',
          artifactOf(assistantText, payloads, PASTED_CHAPTER),
        )
        if (!judge.pass) failures.push('judge: ' + judge.reasoning.join(' | '))
        return {
          caseId,
          attempt,
          pass: failures.length === 0,
          failures,
          toolNames,
          judge,
          assistantText,
          payloads,
        }
      }),
    CASE_TIMEOUT_MS,
  )

  // Downstream of an incomplete reading: the record carries no existing law
  // and the scratchpad carries the gap. The draft still gets written (the
  // user chose to continue) and says the current code is unverified, without
  // describing or amending provisions nobody read.
  it(
    'draft after an incomplete reading states the limitation and invents no current law',
    () =>
      runCase('OF-draft-unread', async (attempt) => {
        const caseId = 'OF-draft-unread'
        const { ordinance, toolNames, payloadsFor, assistantText } =
          await runTurn({
            step: 'draft',
            message:
              "Let's begin. Draft the ordinance from what the prior steps settled.",
            beforeTurn: async (ordinanceId) => {
              await service.prisma.ordinance.update({
                where: { id: ordinanceId },
                data: {
                  existingLaw: Prisma.DbNull,
                  scratchpad: [
                    {
                      step: 'current_law',
                      text: UNREAD_NOTE,
                      createdAt: formatISO(new Date()),
                    },
                  ],
                },
              })
            },
          })
        const failures: string[] = []
        const drafts = payloadsFor('present_draft') as {
          body?: string
          description?: string
        }[]
        const draft = drafts[0]
        if (!draft || ordinance.draftBody === null) {
          failures.push('no draft presented')
        }
        const payloads: Payloads = { present_draft: drafts }
        const judge = await judgeGate(
          'The lead-in, the draft description, or the draft itself says the ' +
            'current city code could not be read and that its overlap or ' +
            'conflict with existing provisions is unverified; and neither ' +
            'the reply nor the draft describes, quotes, cites or amends a ' +
            'provision of the existing city code as current law. New ' +
            'section numbers the draft gives its own text, and state law ' +
            'cited as state law, are fine.',
          artifactOf(assistantText, payloads),
        )
        if (!judge.pass) failures.push('judge: ' + judge.reasoning.join(' | '))
        return {
          caseId,
          attempt,
          pass: failures.length === 0,
          failures,
          toolNames,
          judge,
          assistantText,
          payloads,
        }
      }),
    CASE_TIMEOUT_MS,
  )
})
