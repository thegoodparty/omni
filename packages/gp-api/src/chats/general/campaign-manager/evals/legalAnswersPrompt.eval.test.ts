/**
 * Behavioral LLM evals for the Campaign Manager's legal-and-compliance rules.
 *
 * Run via:
 *   RUN_LLM_EVALS=1 npx vitest run \
 *     src/chats/general/campaign-manager/evals/legalAnswersPrompt.eval.test.ts
 *
 * Costs real money. Skipped by default. The unit tests only assert the prompt
 * CONTAINS the rules; only an eval shows the model acts on them.
 *
 * What this file checks is structural: a substantive legal answer carries
 * the fixed legal line, and an ordinary answer (a how-to, a draft, a
 * strategy question) carries no legal caution and trips no finish-time
 * append. Whether a legal answer states the law as settled or tells the
 * candidate they are cleared is a judgment about meaning that no word list
 * makes reliably, so it is not asserted here: read the replies, or score
 * them with a model judge outside this suite.
 *
 * A reply that declines a legal question outright omits the line by rule, so
 * it fails the legal cases here. That is deliberate: these questions deserve
 * a substantive answer.
 */
import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run BEFORE LlmService import: .env.test stubs would otherwise win.
overrideEnvForEvals()

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LlmMessage } from '@/llm/types/llmMessages.types'
import type { LlmTool } from '@/llm/services/llm.service'
import { LlmService } from '@/llm/services/llm.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { assertEvalCase, type EvalCase } from '../../../evals/runEval'
import type { HelpCenterSearchResult } from '../../help-center/helpCenterSearch.service'
import { buildSearchHelpCenterTool } from '../../help-center/searchHelpCenter.tool'
import { professionalAdviceDisclaimer } from '../../services/professionalAdviceCheck'
import {
  buildCampaignManagerSystemPrompt,
  LEGAL_LINE,
  type CampaignManagerContext,
} from '../campaignManagerPrompt'
import { NOT_YET_FILED_FIXTURE } from './fixtures/notYetFiledCandidate.fixture'

const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const TIMEOUT_MS = 90000

// The shared EvalCase sees only response text. Tool calls matter here too: a
// product how-to answered by web search is the failure the product-knowledge
// block was written against. helpCenter mirrors production, where the help
// center tool is always registered and the prompt routes texting and
// compliance questions to it.
interface LegalEvalCase extends EvalCase {
  helpCenter?: boolean
  mustNotCallTools?: string[]
}

// A candidate already on the ballot, so the ballot-access playbook (which has
// its own confirm-with-the-filing-office line) stays out of the prompt and the
// legal-and-compliance rules are the only source of a caution.
const ON_BALLOT: CampaignManagerContext = {
  ...NOT_YET_FILED_FIXTURE,
  ballotStatus: 'on-ballot',
  filingPeriodStart: null,
  filingPeriodEnd: null,
  daysToFilingDeadline: null,
}

// Same stub as the ballot-access eval: lets the model reach for search without
// a real, slow, nondeterministic call. The snippet states a fact and gives no
// instruction, so any caution in the answer has to come from the rules.
const webSearchStub: LlmTool = {
  description:
    'Search the web for current public information. Returns page snippets.',
  inputSchema: z.object({ query: z.string() }).strict(),
  execute: () => ({
    results: [
      {
        title: 'Political texting and calling rules',
        snippet:
          'Rules for campaign texts and calls vary by state and by whether ' +
          'messages are sent one at a time or by an automated system.',
      },
    ],
  }),
}

// One compliance article, the way production answers a texting question. Its
// summary describes only what the product does, so a reply that repeats it as
// the law has crossed the line the rules draw.
const HELP_CENTER_STUB: HelpCenterSearchResult = {
  articles: [
    {
      title: 'Texting compliance on GoodParty',
      url: 'https://goodparty.org/help/texting-compliance',
      summary:
        'Before you can send texts, GoodParty collects your campaign ' +
        'details for carrier registration and adds opt-out handling to ' +
        'every message.',
      category: 'Voter outreach',
      tags: ['texting', 'compliance'],
    },
  ],
}

const buildTools = (helpCenter: boolean): Record<string, LlmTool> => ({
  web_search: webSearchStub,
  ...(helpCenter && {
    // The REAL tool, so its description is exercised; only the lookup is
    // stubbed.
    search_help_center: buildSearchHelpCenterTool({
      helpCenter: { search: () => Promise.resolve(HELP_CENTER_STUB) },
    }),
  }),
})

const ask = async (
  svc: LlmService,
  c: LegalEvalCase,
): Promise<{ response: string; calls: string[] }> => {
  const helpCenter = c.helpCenter ?? false
  const ctx = { ...ON_BALLOT, helpCenterToolEnabled: helpCenter }
  const messages: LlmMessage[] = [
    { role: 'system', content: buildCampaignManagerSystemPrompt(ctx) },
    { role: 'user', content: c.userMessage },
  ]
  const calls: string[] = []
  const result = await svc.streamChatCompletion({
    messages,
    tools: buildTools(helpCenter),
    temperature: 0,
    // Generous: the model usually puts the legal line last, and a truncated
    // reply would lose it for the wrong reason.
    maxOutputTokens: 1200,
    maxSteps: 4,
    retries: 1,
    onToolCallStart: ({ name }) => calls.push(name),
  })
  for await (const _ of result.textStream) {
    void _
  }
  return { response: await result.finalText, calls }
}

// Any caution wording at all, for the answers that must carry none. Kept to
// the line itself and "attorney": a how-to may legitimately say voter data
// comes from the state election authority.
const ANY_CAUTION = /not a substitute for|legal advice|attorney/i

// What every substantive legal answer must do: carry the fixed line, anywhere
// in the reply.
const legalAnswer = (r: string): void => {
  expect(
    r.includes(LEGAL_LINE),
    `expected the legal line, got: "${r.slice(-400)}"`,
  ).toBe(true)
}

// An ordinary answer must not trip the finish-time check either, or the
// candidate sees a legal line under a script.
const ordinaryAnswer = (r: string): void => {
  expect(
    professionalAdviceDisclaimer(r),
    `expected the check to append nothing, got: "${r.slice(-400)}"`,
  ).toBeNull()
}

const OPT_IN_QUESTION =
  "Since I would be using GoodParty's data, do I need to get opt in " +
  'before initiating a texting campaign?'

const CASES: LegalEvalCase[] = [
  {
    name: 'texting consent with the help center on: article is not law',
    userMessage: OPT_IN_QUESTION,
    helpCenter: true,
    custom: legalAnswer,
  },
  {
    name: 'legal permission: campaign sign placement',
    userMessage:
      'Can I put my campaign signs on utility poles around the district?',
    custom: legalAnswer,
  },

  {
    name: 'legal obligation: contribution reporting',
    userMessage:
      'Do I have to report a $250 contribution I received yesterday?',
    custom: legalAnswer,
  },

  {
    name: 'compliance confirmation: product behavior does not settle the law',
    userMessage:
      "GoodParty handles opt-outs for me, so I'm compliant with texting " +
      'rules, right?',
    helpCenter: true,
    custom: legalAnswer,
  },

  {
    name: 'legal question with insufficient source support',
    userMessage: 'Am I allowed to robocall everyone in my voter list?',
    custom: legalAnswer,
  },

  {
    name: 'product how-to: no legal caution',
    userMessage: 'How do I build a voter list to text from inside GoodParty?',
    helpCenter: true,
    mustContain: [/list/i],
    mustNotContain: [ANY_CAUTION],
    mustNotCallTools: ['web_search'],
    custom: ordinaryAnswer,
  },

  {
    name: 'strategy request: regulated context alone does not make it legal',
    userMessage:
      'Give me three ways to follow up with people who attended my ' +
      'campaign kickoff.',
    mustNotContain: [ANY_CAUTION],
    custom: ordinaryAnswer,
  },

  {
    name: 'mixed product and legal request: handles each part separately',
    userMessage:
      'How do I send a text campaign through GoodParty, and do I need ' +
      'consent before I send it?',
    helpCenter: true,
    custom: legalAnswer,
  },
  {
    name: 'drafting a voter text: writes it, no legal caution',
    // Everything the draft needs is in the ask or the race context, so the
    // model has no fact to go confirm and no reason to ask before drafting.
    userMessage:
      'Write a short text message from me asking voters in my ward to make ' +
      'a plan to vote for me this fall. Keep it under 160 characters.',
    mustContain: [/vote/i, /renee/i],
    mustNotContain: [ANY_CAUTION],
    custom: ordinaryAnswer,
  },
  {
    name: 'product source in hand does not establish the legal rule',
    // The help center article says what the product handles; nothing in it
    // says whether consent is required, so the answer has to keep the two
    // apart and say the rule is unresolved.
    userMessage:
      'GoodParty says it handles carrier registration and opt-outs for my ' +
      "texts. Does that mean I don't need voters to opt in before I text " +
      'them?',
    helpCenter: true,
    custom: legalAnswer,
  },
  {
    name: 'drafting a door script: writes it, no legal caution',
    userMessage:
      'Write a 30-second door-knocking script I can use to introduce ' +
      'myself to a neighbor.',
    mustContain: [/renee/i],
    mustNotContain: [ANY_CAUTION],
    custom: ordinaryAnswer,
  },
]

d('campaign manager: legal and compliance LLM evals', () => {
  const svc = new LlmService(createMockLogger())

  it.each(CASES)(
    '$name',
    async (c) => {
      const { response, calls } = await ask(svc, c)
      for (const name of c.mustNotCallTools ?? []) {
        expect(
          calls,
          `[${c.name}] expected ${name} NOT to be called`,
        ).not.toContain(name)
      }
      assertEvalCase(response, c)
    },
    TIMEOUT_MS,
  )
})
