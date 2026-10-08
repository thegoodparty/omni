import { randomUUID } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'
import { z } from 'zod'
import type { ChatAnchor } from '@goodparty_org/contracts'
import { throttleRequestsWithRetry } from '@/vendors/clerk/util/throttleRequestsWithRetry.util'

// ONE THROWAWAY ACCOUNT PER (CASE, ATTEMPT), made on a deployed gp-api the
// way a person would make one: a Clerk user, a backend-minted session token,
// then gp-api's own user routes. Nothing here writes to a database, and the
// app has no judge-specific route, header or hook.
//
// The dev Clerk instance serves dev and every PR preview, so one secret makes
// an account either arm can use. The pattern is gp-webapp's headless test
// user (e2e-tests/tests/utils/headless-user.ts).

export const JUDGE_CLERK_SECRET_ENV = 'JUDGE_CLERK_SECRET_KEY'

export class JudgeAccountError extends Error {}

export interface BriefingChatAnchor {
  jsonPath: string | null
  start: number | null
  end: number | null
}

export interface BriefingChatTarget {
  meetingDate: string
  anchor: BriefingChatAnchor
}

// What a chat case is driven with. `anchor` for the two anchor-keyed scopes,
// `briefing` for briefing_annotation, neither for the rest.
export interface JudgeAccount {
  token: string
  organizationSlug: string
  anchor?: ChatAnchor
  briefing?: BriefingChatTarget
}

export interface ClerkPort {
  createUser: (email: string, password: string) => Promise<string>
  mintToken: (clerkUserId: string) => Promise<string>
  deleteUser: (clerkUserId: string) => Promise<void>
}

// An hour, so a token minted at the start of a case outlives every turn of it.
const TOKEN_TTL_SECONDS = 60 * 60

// The instance allows 100 Backend API requests per 10s, shared with every e2e
// run and with gp-api's own lookups. A fifth of it is the judge's.
export const clerkPortFrom = (secretKey: string): ClerkPort => {
  const clerk = createClerkClient({ secretKey })
  const throttled = throttleRequestsWithRetry({
    rateLimit: 100,
    windowMs: 10_000,
    safetyFactor: 0.2,
    label: 'judge-clerk',
  })
  return {
    createUser: async (email, password) => {
      const user = await throttled(() =>
        clerk.users.createUser({
          emailAddress: [email],
          password,
          firstName: 'Judge',
          lastName: 'Fixture',
          skipPasswordChecks: true,
        }),
      )
      return user.id
    },
    mintToken: async (clerkUserId) => {
      const session = await throttled(() =>
        clerk.sessions.createSession({ userId: clerkUserId }),
      )
      const { jwt } = await throttled(() =>
        clerk.sessions.getToken(session.id, undefined, TOKEN_TTL_SECONDS),
      )
      return jwt
    },
    deleteUser: async (clerkUserId) => {
      await throttled(() => clerk.users.deleteUser(clerkUserId))
    },
  }
}

// gp-api's test-user rule (users/util/users.util.ts), which is what lets
// POST /v1/campaigns/mine/test-set-pro make the campaign Pro.
export const judgeAccountEmail = (): string =>
  `qa-${randomUUID()}@goodparty.org`

const REQUEST_TIMEOUT_MS = 60_000

// A cold preview answers 502-504 until its task is healthy, and gp-api
// answers a bare 401 for a new Clerk user while the shared Clerk budget is
// spent. Both pass; only the first call of an account meets them.
const RETRIABLE = new Set([401, 502, 503, 504])
const FIRST_CALL_ATTEMPTS = 7

interface Call {
  method: 'GET' | 'POST'
  path: string
  body?: object
  organizationSlug?: string
}

export interface AccountHttp {
  baseUrl: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const send = async (
  http: AccountHttp,
  token: string,
  call: Call,
): Promise<Response> =>
  (http.fetchImpl ?? fetch)(`${http.baseUrl}${call.path}`, {
    method: call.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(call.body !== undefined && { 'content-type': 'application/json' }),
      ...(call.organizationSlug !== undefined && {
        'x-organization-slug': call.organizationSlug,
      }),
    },
    ...(call.body !== undefined && { body: JSON.stringify(call.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

const refusal = async (call: Call, response: Response): Promise<never> => {
  const text = (await response.text()).slice(0, 200)
  throw new JudgeAccountError(
    `${call.method} ${call.path.split('?')[0]} returned ${response.status}` +
      (text === '' ? '' : `: ${text}`),
  )
}

const request = async <T>(
  http: AccountHttp,
  token: string,
  call: Call,
  schema: z.ZodType<T>,
): Promise<T> => {
  const response = await send(http, token, call)
  if (!response.ok) return refusal(call, response)
  return schema.parse(await response.json())
}

const firstRequest = async (
  http: AccountHttp,
  token: string,
  call: Call,
): Promise<void> => {
  const sleep =
    http.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 1; ; attempt++) {
    const response = await send(http, token, call).catch(() => undefined)
    if (response?.ok) return
    const last = attempt === FIRST_CALL_ATTEMPTS
    if (response !== undefined && (last || !RETRIABLE.has(response.status))) {
      return refusal(call, response)
    }
    if (last) {
      throw new JudgeAccountError(
        `${call.method} ${call.path} got no response from ${http.baseUrl}`,
      )
    }
    await sleep(Math.min(1_000 * 2 ** (attempt - 1), 20_000))
  }
}

const IdSchema = z.object({ id: z.string() })
const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
})
const CampaignSchema = z.object({
  id: z.number(),
  organizationSlug: z.string().nullish(),
})
const OrdinanceSchema = z.object({ id: z.string(), slug: z.string() })
const BriefingSeedSchema = z.object({ meetingDate: z.string() })

const CHAT_AGENT_SCOPES: Record<string, string> = {
  chief_of_staff: 'chief_of_staff',
  campaign_assistant: 'campaign_assistant',
  ordinance_flow: 'ordinance_flow',
  priority_flow: 'priority_flow',
  briefing_annotation: 'briefing_annotation',
}

export const chatScopeFor = (agentId: string): string => {
  const scope = CHAT_AGENT_SCOPES[agentId]
  if (scope === undefined) {
    throw new Error(
      `"${agentId}" is not a chat scope the runner can drive; the ` +
        `registered scopes are ${Object.keys(CHAT_AGENT_SCOPES).join(', ')}`,
    )
  }
  return scope
}

// FIXED DATES, not dates relative to now: both arms of a comparison must
// render the same prompt when the branch changed nothing the agent can see.
// raceId only when the sweep resolved a real one, which is what
// get_ballot_requirements registers on.
export const judgeCampaignDetails = (raceId?: string) => ({
  normalizedOffice: 'City Council',
  ballotLevel: 'CITY',
  district: 'District 1',
  state: 'WA',
  city: 'Judge City',
  electionDate: '2027-11-02',
  primaryElectionDate: '2027-08-03',
  filingPeriodsStart: '2027-05-10',
  filingPeriodsEnd: '2027-05-21',
  ...(raceId !== undefined && { raceId }),
})

const snapshotFor = (title: string) => ({
  title,
  summary: `Judge fixture for ${title}.`,
})

export const JUDGE_MEETING_DATE = '2026-05-19'

// The Hendersonville council meeting the briefing prompt evals use
// (briefing-chats/evals/fixtures/hendersonvilleBriefing.fixture.ts), in the
// shape POST /v1/meetings/briefings/seed takes: at most five items, each a
// title, a summary and optionally three talking points.
const WATER_WHY_IT_MATTERS =
  'Without the study, the council will be setting rates blind during the ' +
  'FY2027 budget. Deferring also delays a $24M revenue bond rating review.'

const WATER_SUMMARY =
  'Public Works requests $180K from FY2026 reserves to engage Raftelis ' +
  'Financial Consultants for a cost-of-service study, which will likely ' +
  'conclude rates need to rise 8-15% over the next 4 years. ' +
  WATER_WHY_IT_MATTERS

export const JUDGE_BRIEFING_SEED = {
  meetingDate: JUDGE_MEETING_DATE,
  meetingName: 'City Council',
  meetingTime: '18:30',
  meetingTimezone: 'America/New_York',
  location: 'City Hall Council Chambers',
  officialName: 'Test Official',
  items: [
    {
      title: 'Amendment to Short-Term Rental Ordinance',
      summary:
        'Staff is recommending an amendment to existing Chapter 12 limiting ' +
        'STR registrations to one per natural person, with a 90-day ' +
        'transition window. Current ordinance has no cap; ~340 active STRs ' +
        'are concentrated in <50 owners. Three neighborhood associations ' +
        'have organized against investor concentration; real-estate groups ' +
        'argue it will harm property values and tax base.',
      budgetImpactSummary: '~$1.8M annual occupancy tax revenue is at stake.',
      talkingPoints: [
        {
          text: 'How will the cap be enforced? Who audits LLC ownership chains?',
          why: 'Asheville passed a similar cap in 2024; enforcement litigation is ongoing.',
        },
        {
          text: 'Propose a 6-month sunset clause so we can review enforcement data before making it permanent.',
          why: 'Approve with the sunset clause. Gets the political win and bakes in an off-ramp if enforcement falters.',
        },
        {
          text: 'What is the projected impact on occupancy-tax revenue?',
          why: 'Real-estate-industry groups argue the cap will shrink the tax base.',
        },
      ],
    },
    {
      title: 'Authorize Cost-of-Service Water Rate Study',
      summary: WATER_SUMMARY,
      budgetImpactSummary: '$180K from FY2026 reserves.',
      talkingPoints: [
        {
          text: 'What is our debt-service coverage right now and what does it need to be by 2028?',
          why: 'Aging infrastructure (avg 47 years old) and three large capital projects drive the need.',
        },
        {
          text: 'What is the realistic timeline if we defer six months? Does it push the bond review?',
          why: WATER_WHY_IT_MATTERS,
        },
        {
          text: 'The study itself is not a rate hike; it is the basis for an informed conversation.',
          why: 'Approving the study is not approving a rate increase.',
        },
      ],
    },
    {
      title: 'Acceptance of FY2024 Annual Audit',
      summary:
        'Routine acceptance of the audited financial statements. Auditor ' +
        'present to answer questions.',
    },
    {
      title: 'Resolution Recognizing Local Volunteer of the Year',
      summary: 'Ceremonial resolution recognizing a local volunteer.',
    },
  ],
}

// The one note the official has written on the briefing, on a passage of the
// water-rate item. A note is what registers get_my_notes.
const NOTE_PHRASE = '$24M revenue bond rating review'
const NOTE_PATH = '/items/1/display/summary'
const noteStart = WATER_SUMMARY.indexOf(NOTE_PHRASE)
export const JUDGE_NOTE = {
  kind: 'note',
  anchor: {
    json_path: NOTE_PATH,
    start: noteStart,
    end: noteStart + NOTE_PHRASE.length,
  },
  payload: {
    body:
      'Ask Pat whether deferring pushes the bond rating review past the ' +
      'FY2027 budget vote. Leaning toward approving the study.',
  },
}

// The scope's state, set up through the user routes and nothing else: an
// elected office for the four Serve scopes, plus the priority, ordinance or
// briefing and note the scope is anchored on; a Pro campaign for
// campaign_assistant.
export const setUpScope = async (
  http: AccountHttp,
  token: string,
  agentId: string,
  raceId?: string,
): Promise<Omit<JudgeAccount, 'token'>> => {
  const scope = chatScopeFor(agentId)

  if (scope === 'campaign_assistant') {
    const campaign = await request(
      http,
      token,
      {
        method: 'POST',
        path: '/v1/campaigns',
        body: { details: judgeCampaignDetails(raceId) },
      },
      CampaignSchema,
    )
    const organizationSlug =
      campaign.organizationSlug ?? `campaign-${campaign.id}`
    await request(
      http,
      token,
      {
        method: 'POST',
        path: '/v1/campaigns/mine/test-set-pro',
        body: {},
        organizationSlug,
      },
      z.unknown(),
    )
    return { organizationSlug }
  }

  const office = await request(
    http,
    token,
    {
      method: 'POST',
      path: '/v1/elected-office',
      body: { customPositionName: 'Council Member' },
    },
    ElectedOfficeSchema,
  )
  const { organizationSlug } = office

  if (scope === 'ordinance_flow') {
    const ordinance = await request(
      http,
      token,
      {
        method: 'POST',
        path: '/v1/ordinances',
        body: {
          seedType: 'new',
          goalText:
            'Require covered bicycle parking at new multifamily builds.',
        },
        organizationSlug,
      },
      OrdinanceSchema,
    )
    return {
      organizationSlug,
      anchor: {
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        url: `https://goodparty.org/ordinances/${ordinance.slug}`,
        snapshot: snapshotFor('Bicycle parking ordinance'),
        step: 'clarify',
      },
    }
  }

  if (scope === 'priority_flow') {
    const priority = await request(
      http,
      token,
      {
        method: 'POST',
        path: '/v1/priorities',
        body: {
          title: 'Affordable housing',
          description: 'Expand the supply of affordable housing downtown.',
        },
        organizationSlug,
      },
      IdSchema,
    )
    return {
      organizationSlug,
      anchor: {
        resourceType: 'priority',
        resourceId: priority.id,
        url: `https://goodparty.org/priorities/${priority.id}`,
        snapshot: snapshotFor('Affordable housing'),
      },
    }
  }

  if (scope === 'briefing_annotation') {
    const seeded = await request(
      http,
      token,
      {
        method: 'POST',
        path: '/v1/meetings/briefings/seed',
        body: JUDGE_BRIEFING_SEED,
        organizationSlug,
      },
      BriefingSeedSchema,
    )
    await request(
      http,
      token,
      {
        method: 'POST',
        path: `/v1/meetings/${seeded.meetingDate}/briefing/annotations`,
        body: JUDGE_NOTE,
        organizationSlug,
      },
      z.unknown(),
    )
    return {
      organizationSlug,
      briefing: {
        meetingDate: seeded.meetingDate,
        anchor: { jsonPath: null, start: null, end: null },
      },
    }
  }

  return { organizationSlug }
}

export interface JudgeAccounts {
  provision: (agentId: string) => Promise<JudgeAccount>
  // Best effort, and never throws: a Clerk user left behind is a throwaway
  // test account, not a reason to fail an arm whose records are written.
  deleteAll: () => Promise<string[]>
}

export const judgeAccounts = (
  http: AccountHttp,
  clerk: ClerkPort,
  raceId?: string,
): JudgeAccounts => {
  const created: string[] = []
  return {
    provision: async (agentId) => {
      chatScopeFor(agentId)
      const clerkUserId = await clerk.createUser(
        judgeAccountEmail(),
        `Judge${randomUUID()}!`,
      )
      created.push(clerkUserId)
      const token = await clerk.mintToken(clerkUserId)
      await firstRequest(http, token, { method: 'GET', path: '/v1/users/me' })
      return { token, ...(await setUpScope(http, token, agentId, raceId)) }
    },
    deleteAll: async () => {
      const failed: string[] = []
      for (const clerkUserId of created.splice(0)) {
        try {
          await clerk.deleteUser(clerkUserId)
        } catch (err) {
          failed.push(
            `${clerkUserId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      return failed
    },
  }
}
