/**
 * Behavioral LLM evals for the Campaign Manager's ballot-access guidance.
 *
 * Run via:
 *   RUN_LLM_EVALS=1 npx vitest run \
 *     src/chats/general/campaign-manager/evals/ballotAccessPrompt.eval.test.ts
 *
 * Costs real money. Skipped by default. These exist because the unit tests only
 * assert the prompt CONTAINS the guidance; only an eval shows the model acts on
 * it. The risk being covered is a confidently wrong filing requirement, which
 * can cost a candidate the ballot.
 */
import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run BEFORE LlmService import — .env.test stubs would otherwise win.
overrideEnvForEvals()

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LlmMessage } from '@/llm/types/llmMessages.types'
import type { LlmTool } from '@/llm/services/llm.service'
import { LlmService } from '@/llm/services/llm.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { ElectionsService } from '@/elections/services/elections.service'
import { assertEvalCase, type EvalCase } from '../../../evals/runEval'
import {
  buildCampaignManagerSystemPrompt,
  type CampaignManagerContext,
} from '../campaignManagerPrompt'
import { buildGetBallotRequirementsTool } from '../getBallotRequirements.tool'
import {
  BALLOT_DATA_EMPTY,
  BALLOT_DATA_FULL,
  NOT_YET_FILED_FIXTURE,
} from './fixtures/notYetFiledCandidate.fixture'

const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const TIMEOUT_MS = 90000

type BallotData = typeof BALLOT_DATA_FULL | typeof BALLOT_DATA_EMPTY

// Superset of the shared EvalCase: these cases also assert which tools the model
// called and in what order, which is the behavior most at risk here. The shared
// assertEvalCase only sees response text, so tool assertions run alongside it.
interface BallotEvalCase extends EvalCase {
  ctx?: Partial<CampaignManagerContext>
  ballotData?: BallotData | null
  mustCallTools?: string[]
  mustNotCallTools?: string[]
  assertToolOrder?: (calls: string[]) => void
}

// web_search is a native Anthropic provider tool in production. Here it is a
// stub function tool with the same name: the eval needs to observe WHETHER and
// WHEN the model reaches for search without doing real, slow, nondeterministic
// searches. Its description mirrors what search is for so the choice between it
// and get_ballot_requirements stays realistic.
const webSearchStub: LlmTool = {
  description:
    'Search the web for current public information. Returns page snippets.',
  inputSchema: z.object({ query: z.string() }).strict(),
  execute: () => ({
    results: [
      {
        title: 'Candidate filing information',
        snippet:
          'Contact your local election authority for candidate filing ' +
          'requirements and deadlines.',
      },
    ],
  }),
}

const buildTools = (ballotData: BallotData | null): Record<string, LlmTool> => {
  const tools: Record<string, LlmTool> = { web_search: webSearchStub }
  if (ballotData !== null) {
    // The REAL tool, so the eval exercises its real description and its
    // noDataFound derivation, with only the upstream call stubbed.
    tools.get_ballot_requirements = buildGetBallotRequirementsTool({
      elections: {
        fetchFilingFeeByRaceHash: () => Promise.resolve(ballotData),
      } as unknown as Pick<ElectionsService, 'fetchFilingFeeByRaceHash'>,
      raceId: 'br-hash-springfield-ward-3',
    })
  }
  return tools
}

const ask = async (
  svc: LlmService,
  c: BallotEvalCase,
): Promise<{ response: string; calls: string[] }> => {
  const ctx: CampaignManagerContext = { ...NOT_YET_FILED_FIXTURE, ...c.ctx }
  const messages: LlmMessage[] = [
    { role: 'system', content: buildCampaignManagerSystemPrompt(ctx) },
    { role: 'user', content: c.userMessage },
  ]
  const calls: string[] = []
  const result = await svc.streamChatCompletion({
    messages,
    tools: buildTools(
      c.ballotData === undefined ? BALLOT_DATA_FULL : c.ballotData,
    ),
    temperature: 0,
    maxOutputTokens: 700,
    maxSteps: 4,
    retries: 1,
    onToolCallStart: ({ name }) => calls.push(name),
  })
  for await (const _ of result.textStream) {
    void _
  }
  return { response: await result.finalText, calls }
}

// A specific dollar amount or signature count the fixture never supplied, which
// would mean the model invented a requirement.
const INVENTED_FEE = /\$(?!100\b)\d{2,}/
const INVENTED_SIGNATURES = /\b(?!25\b)\d{2,}\s+(?:valid\s+)?signatures\b/i

// An explicit "I could not confirm this", in any phrasing. Deliberately broad:
// the fabrication guard is INVENTED_FEE plus the pointer to the elections
// office, and pinning this to one wording just fails on the model's ordinary
// synonyms ("does not include", "did not return", "where the gaps are").
const GAP_ADMISSION =
  /\b(?:do(?:es)? ?n[o']t|did ?n[o']t|could ?n[o']t|can ?n[o']t|cannot|unable|unclear|unknown|not (?:have|listed|available|confirmed?|include)|no (?:record|data|information|listing|deadline|filing period)|gaps?)\b/i

const CASES: BallotEvalCase[] = [
  // ---------- Tool ordering: BallotReady before web search ----------
  {
    name: 'ordering: asks how to get on the ballot -> calls BallotReady first',
    userMessage: 'How do I get on the ballot for my race?',
    mustCallTools: ['get_ballot_requirements'],
    assertToolOrder: (calls) => {
      const br = calls.indexOf('get_ballot_requirements')
      const ws = calls.indexOf('web_search')
      expect(
        br,
        `expected get_ballot_requirements in ${calls}`,
      ).toBeGreaterThanOrEqual(0)
      if (ws >= 0) {
        expect(
          br,
          `BallotReady must precede web_search, got ${calls}`,
        ).toBeLessThan(ws)
      }
    },
  },
  {
    name: 'ordering: petition question also routes through BallotReady',
    userMessage: 'How many signatures do I need on my petition?',
    mustCallTools: ['get_ballot_requirements'],
  },
  // Not an abstain case: for a candidate who has not filed, the prompt makes
  // ballot access the first thing the manager raises, so a general planning
  // question is answered THROUGH filing rather than around it. What has to hold
  // is that the filing specifics come from the tool instead of from memory.
  {
    name: 'week planning: leads through filing, grounded in the tool',
    userMessage: 'What should I focus on this week to win?',
    mustCallTools: ['get_ballot_requirements'],
    mustNotContain: [INVENTED_FEE],
    custom: (r) => {
      expect(
        /ballot|fil(e|ing)|petition/i.test(r),
        `expected the week to be framed around ballot access, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
    },
  },

  // ---------- Grounding in what BallotReady returned ----------
  {
    name: 'grounding: reports the real fee, office, and names BallotReady',
    userMessage: 'What do I need to file?',
    mustContain: ['100', 'ballotready'],
    custom: (r) => {
      expect(
        /monroe|clerk|217-555-0142/i.test(r),
        `expected the filing office from the tool, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
    },
  },
  {
    name: 'grounding: does not invent a fee or signature count',
    userMessage: 'What do I need to file?',
    custom: (r) => {
      expect(INVENTED_FEE.test(r), `invented a fee: "${r.slice(0, 400)}"`).toBe(
        false,
      )
      expect(
        INVENTED_SIGNATURES.test(r),
        `invented a signature count: "${r.slice(0, 400)}"`,
      ).toBe(false)
    },
  },

  // ---------- noDataFound: says so, does not fabricate ----------
  {
    name: 'no data: admits it could not confirm and points at the office',
    userMessage: 'What do I need to file?',
    ballotData: BALLOT_DATA_EMPTY,
    mustNotContain: [INVENTED_FEE],
    custom: (r) => {
      expect(
        GAP_ADMISSION.test(r),
        `expected an explicit gap admission, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
      expect(
        /election|clerk|filing office/i.test(r),
        `expected a pointer to the elections office, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
    },
  },

  // ---------- Deadline: stated from the race record, not re-derived ----------
  {
    name: 'deadline: states the filing period close and the days remaining',
    userMessage: 'When is my filing deadline?',
    mustContain: [/2026-09-15|september 15|sept\.? 15/i, '27'],
  },
  {
    name: 'deadline: a passed deadline is flagged, not counted down',
    userMessage: 'When is my filing deadline?',
    ctx: { filingPeriodEnd: '2026-01-15', daysToFilingDeadline: -40 },
    mustContain: [/passed|behind|already closed/i],
    custom: (r) => {
      expect(
        /stale|out of date|not.*(updated|refreshed)|newer/i.test(r),
        `expected the stale-record reading to be named, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
    },
  },
  {
    name: 'deadline: no filing period on record -> says so, invents nothing',
    userMessage: 'When is my filing deadline?',
    ctx: {
      filingPeriodStart: null,
      filingPeriodEnd: null,
      daysToFilingDeadline: null,
    },
    mustNotContain: [/\b2026-\d{2}-\d{2}\b/],
    custom: (r) => {
      expect(
        GAP_ADMISSION.test(r),
        `expected an explicit unknown-deadline admission, got: "${r.slice(0, 400)}"`,
      ).toBe(true)
    },
  },

  // ---------- Still-deciding candidate is not treated as committed ----------
  {
    name: 'considering: does not assume the candidate has decided to run',
    userMessage: 'I am not sure yet if I want to run. What would it take?',
    ctx: { ballotStatus: 'considering' },
    mustNotContain: [/your campaign will|now that you are running/i],
    mustCallTools: ['get_ballot_requirements'],
  },
]

d('campaign manager — ballot access LLM evals', () => {
  const svc = new LlmService(createMockLogger())

  it.each(CASES)(
    '$name',
    async (c) => {
      const { response, calls } = await ask(svc, c)
      for (const name of c.mustCallTools ?? []) {
        expect(calls, `[${c.name}] expected ${name} to be called`).toContain(
          name,
        )
      }
      for (const name of c.mustNotCallTools ?? []) {
        expect(
          calls,
          `[${c.name}] expected ${name} NOT to be called`,
        ).not.toContain(name)
      }
      c.assertToolOrder?.(calls)
      assertEvalCase(response, c)
    },
    TIMEOUT_MS,
  )
})
