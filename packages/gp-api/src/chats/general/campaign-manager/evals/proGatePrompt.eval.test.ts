/**
 * Behavioral LLM evals for how the Campaign Manager handles a part of the
 * product the campaign cannot use yet.
 *
 * Run via:
 *   RUN_LLM_EVALS=1 npx vitest run \
 *     src/chats/general/campaign-manager/evals/proGatePrompt.eval.test.ts
 *
 * Costs real money. Skipped by default. The unit tests only assert the prompt
 * CARRIES the map's Pro status line and the access rule; only an eval shows
 * the model acts on them.
 *
 * The failure this guards against: a candidate without Pro asks about voter
 * lists, is walked through every filter dimension as though it were
 * available, then asks for a count and learns from a tool's refusal that
 * filtering needs the Pro upgrade. The map now says whether the campaign has
 * Pro, one rule says to name that gate from the map instead of presenting
 * the locked part as available, and the count and precinct tools are not
 * registered for a campaign the row says lacks Pro.
 *
 * Built through the real handler over fake services, so the prompt and the
 * tool list come from the wiring production uses: the campaign row's flag
 * reaches the context, the context reaches the map's status line, and the
 * same flags decide which tools register. One value per case drives the row
 * and every fake, so the prompt and the services never disagree about Pro. A
 * stale flag (row says Pro, service refuses) is a separate manual check, not
 * a case here; the voter-data block's own error sentence covers it.
 *
 * What this file checks is structural: whether Pro is mentioned at all,
 * which tools were called and with which action, whether an invented
 * precinct or an upgrade pitch appears where it should not. Whether the
 * upgrade is tied to the candidate's goal, or whether dimensions are
 * presented as usable now, is a judgment about meaning that no word list
 * makes reliably, so it is not asserted here: read the replies.
 */
import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run BEFORE LlmService import: .env.test stubs would otherwise win.
overrideEnvForEvals()

import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Organization } from '../../../../generated/prisma'
import type { LlmMessage } from '@/llm/types/llmMessages.types'
import type { LlmTool } from '@/llm/services/llm.service'
import { LlmService } from '@/llm/services/llm.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import {
  PRO_FEATURE_REQUIRED_MESSAGE,
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import type { FilterDimension } from '@/contacts/filterDimensions.catalog'
import {
  FILTER_PRO_REQUIRED_MESSAGE,
  type VoterFileFilterService,
} from '@/voters/services/voterFileFilter.service'
import { assertEvalCase, type EvalCase } from '../../../evals/runEval'
import type { GeneralChatStoreService } from '../../services/generalChatStore.prisma'
import type {
  HelpCenterSearchResult,
  HelpCenterSearchService,
} from '../../help-center/helpCenterSearch.service'
import { CampaignManagerHandler } from '../campaignManager.handler'
import { WIN_CONSTITUENT_TABLES } from '../services/constituentDataScope'

const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const TIMEOUT_MS = 90000

interface ToolCall {
  name: string
  input: unknown
}

// pro drives the fake campaign row and every fake service method together.
// priorTurns lets a case start after the gate has already been named once.
// mustCallTools is for the Pro cases; a non-Pro case forbids every gated
// call regardless (see isGatedCall).
interface ProGateEvalCase extends EvalCase {
  pro: boolean
  priorTurns?: LlmMessage[]
  mustCallTools?: string[]
}

const ORG = { slug: 'campaign-eval' } as Organization

// The same made-up candidate the other campaign manager evals use, already
// on the ballot so the ballot-access playbook stays out of the prompt.
const campaignRow = (pro: boolean) => ({
  id: 1,
  organizationSlug: ORG.slug,
  isPro: pro,
  ballotStatus: 'on-ballot',
  details: {
    normalizedOffice: 'City Council',
    district: 'Ward 3',
    ballotLevel: 'city',
    city: 'Springfield',
    state: 'IL',
  },
  data: {},
  user: { firstName: 'Renee', lastName: 'Diaz' },
})

// Three dimensions in the catalog's shape, with value keys the count schema
// accepts, so a Pro count can run end to end through the real tool.
const DIMENSIONS: FilterDimension[] = [
  {
    key: 'ageRange',
    label: 'Age range',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'observed',
    values: [{ key: 'age18_25', label: '18 to 25' }],
  },
  {
    key: 'turnout',
    label: 'Turnout likelihood',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'modeled',
    values: [
      { key: 'audienceLikelyVoters', label: 'Likely voters' },
      { key: 'audienceUnlikelyVoters', label: 'Unlikely voters' },
    ],
  },
  {
    key: 'cellPhone',
    label: 'Cell phone on file',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'observed',
    values: [{ key: 'hasCellPhone', label: 'Has a cell phone' }],
  },
]

const PRECINCTS = [
  { county: 'Example County', precinct: '101', voters: 812 },
  { county: 'Example County', precinct: '102', voters: 640 },
]

// Same stub as the legal eval: lets the model reach for search without a
// real, slow, nondeterministic call. The snippet says nothing about the
// product, so nothing in a reply about access can have come from here.
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

// One neutral article, so a gate named in a reply can only have come from
// the map, not from something the help center said.
const HELP_CENTER_STUB: HelpCenterSearchResult = {
  articles: [
    {
      title: 'Finding your way around the dashboard',
      url: 'https://goodparty.org/help/dashboard-tour',
      summary:
        'The left-hand menu lists every part of your dashboard. Each page ' +
        'opens with a short description of what you can do there.',
      category: 'Getting started',
      tags: ['dashboard'],
    },
  ],
}

// The handler as production wires it, over fakes for everything that would
// touch a database or an outside service. Services left out (constituent
// data, district resolution, story intake, elections) keep their tools dark
// and their prompt blocks absent, which is also what a campaign without them
// gets.
const buildHandler = (pro: boolean): CampaignManagerHandler => {
  const gated = <T>(value: T, message: string): Promise<T> =>
    pro
      ? Promise.resolve(value)
      : Promise.reject(new ForbiddenException(message))
  const store = {
    findFirst: vi.fn(() =>
      Promise.resolve({ id: 'conv-1', organizationSlug: ORG.slug }),
    ),
  } as unknown as GeneralChatStoreService
  const campaigns = {
    client: {
      campaign: { findFirst: vi.fn(() => Promise.resolve(campaignRow(pro))) },
      campaignTrackerTask: { findMany: vi.fn(() => Promise.resolve([])) },
      organization: { findFirst: vi.fn(() => Promise.resolve(ORG)) },
    },
  } as unknown as CampaignsService
  const contacts = {
    getFilterDimensions: () => DIMENSIONS,
    countContacts: () => gated({ count: 1234 }, PRO_FILTERING_REQUIRED_MESSAGE),
    getPrecincts: () =>
      gated(
        { options: PRECINCTS, truncated: false },
        PRO_FEATURE_REQUIRED_MESSAGE,
      ),
    countSegment: () => gated({ count: 0 }, PRO_FILTERING_REQUIRED_MESSAGE),
  } as unknown as ContactsService
  const voterFileFilters = {
    // Listing is not gated in the service; neither eval campaign has a list.
    findByOrganizationSlug: () => Promise.resolve([]),
    filterAccessCheck: () => gated(undefined, FILTER_PRO_REQUIRED_MESSAGE),
    findByIdAndOrganizationSlug: vi.fn(),
    create: vi.fn(),
    updateByIdAndOrganizationSlug: vi.fn(),
    deleteByIdAndOrganizationSlug: vi.fn(),
  } as unknown as VoterFileFilterService
  const helpCenter = {
    search: () => Promise.resolve(HELP_CENTER_STUB),
  } as unknown as HelpCenterSearchService
  return new CampaignManagerHandler(
    store,
    campaigns,
    {} as ChatStoreService,
    WIN_CONSTITUENT_TABLES,
    undefined,
    undefined,
    undefined,
    contacts,
    voterFileFilters,
    undefined,
    helpCenter,
  )
}

// A call that a campaign without Pro cannot make. Listing saved lists is the
// one saved-list action the service does not gate; the other four reach it.
const isGatedCall = (call: ToolCall): boolean => {
  if (call.name === 'count_contacts' || call.name === 'list_precincts') {
    return true
  }
  if (call.name !== 'crud_saved_filters') return false
  const action =
    typeof call.input === 'object' &&
    call.input !== null &&
    'action' in call.input
      ? call.input.action
      : undefined
  return action !== 'list'
}

const ask = async (
  svc: LlmService,
  c: ProGateEvalCase,
): Promise<{ response: string; calls: ToolCall[] }> => {
  const handler = buildHandler(c.pro)
  const ctx = await handler.loadContext('conv-1', 1)
  // The wiring under test, checked before any model call is paid for.
  expect(ctx.isPro).toBe(c.pro)
  const tools: Record<string, LlmTool> = {
    ...handler.buildTools(ctx),
    // The handler registers Anthropic's native search whenever the key is
    // present. The stub keeps the eval fast and deterministic.
    web_search: webSearchStub,
  }
  const messages: LlmMessage[] = [
    { role: 'system', content: handler.buildSystemPrompt(ctx) },
    ...(c.priorTurns ?? []),
    { role: 'user', content: c.userMessage },
  ]
  const calls: ToolCall[] = []
  const result = await svc.streamChatCompletion({
    messages,
    tools,
    temperature: 0,
    // The Pro cases list dimensions or precincts; a truncated reply would
    // fail them for the wrong reason.
    maxOutputTokens: 1000,
    maxSteps: 4,
    retries: 1,
    onToolCallStart: ({ name, input }) => calls.push({ name, input }),
  })
  for await (const _ of result.textStream) {
    void _
  }
  return { response: await result.finalText, calls }
}

// The whole word, case-sensitive: the tier, not "pro-" anything.
const MENTIONS_PRO = /\bPro\b/
// For the replies that must not bring access up at all.
const ANY_ACCESS_TALK = [/\bpro\b/i, /upgrade/i]

const VOTER_LIST_QUESTION =
  'Is there a voter list so I can target voters in my district?'
const PRECINCT_QUESTION = 'Which precincts are in my district?'

const CASES: ProGateEvalCase[] = [
  {
    name: 'no Pro: asks about a voter list',
    pro: false,
    userMessage: VOTER_LIST_QUESTION,
    mustContain: [MENTIONS_PRO],
  },
  {
    name: 'no Pro: asks which precincts are in the district',
    pro: false,
    userMessage: PRECINCT_QUESTION,
    mustContain: [MENTIONS_PRO],
    // The service returned nothing, so any numbered precinct is invented.
    mustNotContain: [/precinct\s*#?\s*\d/i],
  },
  {
    name: 'Pro: asks about a voter list, gets the dimensions',
    pro: true,
    userMessage: VOTER_LIST_QUESTION,
    mustContain: [/age range|turnout|cell phone/i],
    mustNotContain: [/upgrade/i],
  },
  {
    name: 'Pro: asks which precincts are in the district, gets them',
    pro: true,
    userMessage: PRECINCT_QUESTION,
    mustCallTools: ['list_precincts'],
    mustContain: ['101', '102'],
    mustNotContain: [/upgrade/i],
  },
  {
    name: 'no Pro: asks for a door script, nothing about access',
    pro: false,
    userMessage: 'Write me a 30-second door knocking script.',
    mustNotContain: ANY_ACCESS_TALK,
  },
  {
    name: 'no Pro: asks what voters can be filtered by',
    pro: false,
    userMessage: 'What can I filter voters by? Just curious.',
    mustContain: [MENTIONS_PRO],
    // The catalog is the same for every campaign and none of it applies
    // without Pro; a "free tier" of filters is an invention seen once.
    mustNotContain: [/free tier|free account/i],
  },
  {
    name: 'no Pro: asks for a count after the gate was already named',
    pro: false,
    priorTurns: [
      { role: 'user', content: VOTER_LIST_QUESTION },
      {
        role: 'assistant',
        content:
          'Filtering the voter file needs the Pro upgrade, which your ' +
          'campaign does not have yet. The Pro upgrade tab is where that ' +
          'happens. Once you have it, you can build lists by age, turnout ' +
          'likelihood, and whether a cell phone is on file.',
      },
    ],
    userMessage: 'Count my likely voters anyway.',
    mustContain: [MENTIONS_PRO],
  },
  {
    name: 'no Pro: asks about opponents, a second gated area',
    pro: false,
    userMessage: 'What do you know about my opponents?',
    mustContain: [MENTIONS_PRO],
  },
  {
    name: 'no Pro: asks where to edit the public profile, an open area',
    pro: false,
    userMessage: 'Where do I edit my public profile?',
    mustContain: ['Public Profile'],
    mustNotContain: ANY_ACCESS_TALK,
  },
]

d('campaign manager: locked product areas LLM evals', () => {
  const svc = new LlmService(createMockLogger())

  it.each(CASES)(
    '$name',
    async (c) => {
      const { response, calls } = await ask(svc, c)
      const names = calls.map((call) => call.name)
      for (const name of c.mustCallTools ?? []) {
        expect(names, `[${c.name}] expected ${name} to be called`).toContain(
          name,
        )
      }
      if (!c.pro) {
        // A gated call that fails and is then relayed is the failure this
        // rule exists to stop, so learning about Pro from a refusal cannot
        // pass a case.
        expect(
          calls.filter(isGatedCall),
          `[${c.name}] expected no gated tool call, got: ${JSON.stringify(calls)}`,
        ).toEqual([])
      }
      assertEvalCase(response, c)
    },
    TIMEOUT_MS,
  )
})
