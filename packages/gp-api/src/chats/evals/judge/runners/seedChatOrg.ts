import { createHash } from 'node:crypto'
import type { ChatAnchor, OrdinanceFlowStep } from '@goodparty_org/contracts'
import {
  AnnotationKind,
  AnnotationResourceType,
  ChatScope,
  ExperimentRunStatus,
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
  OrdinanceSeedType,
  PrioritySource,
  type PrismaClient,
} from '../../../../generated/prisma'
import type { PositionWithOptionalDistrict } from '@/elections/types/elections.types'
import type { BriefingChatAnchor } from '@/chats/briefing-chats/services/briefingChatCreate.service'
import { parseIsoDateAsUTC } from '@/shared/util/date.util'
import { CaseListError, type ChatAccountState } from '../cases'
import {
  JUDGE_BRIEFING_BUCKET,
  JUDGE_HIGHLIGHT_ANCHOR,
  JUDGE_MEETING_DATE,
  JUDGE_MEETING_TIME,
  JUDGE_MEETING_TIMEZONE,
  JUDGE_NOTE,
  TOP_LEVEL_ANCHOR,
  judgeBriefingKey,
} from './briefingFixture'
import { assertTestProcess } from './chatSeam'

// The minimum state a chat scope needs before a real turn can be driven
// through the HTTP routes, per scope. Each scope's loadContext throws a 404
// when its own row is missing, so a run against an unseeded database fails as
// an infraError rather than producing anything to judge.
//
// Seeded slugs are derived from the case id rather than randomised. Both arms
// of a comparison must render the SAME system prompt when the branch changed
// nothing the agent can see, and a random slug that reached the prompt would
// make every configDigest differ — permanently disarming the orchestrator's
// refusal to compare two identical configs. Everything else seeded here is
// fixed for the same reason: nothing derived from the clock.
//
// SEEDS THE STATE THAT DECIDES WHICH TOOLS REGISTER, not just the state that
// keeps loadContext from 404ing. A scope handler assembles its tool set from
// its context, so a row left out here does not merely thin an answer — it
// takes a tool off the model's list, and the run then measures whether the
// agent is honest about a capability it was never given. The three that were
// costing whole tool families, and what each one buys:
//
//   organization.positionId    the district gate, and only half of it: see
//                              JUDGE_POSITION below.
//   campaign.isPro + details   the voter-file family and
//                              get_ballot_requirements.
//   the anchor's ordinance     the five steps past clarify, each of which
//   step                       carries its own present_* tools.
//   a note on the briefing     get_my_notes, for briefing_annotation.

export interface SeededChatOrg {
  organizationSlug: string
  electedOfficeId?: string
  // Present for the two anchor-keyed scopes. POST /v1/chats rejects those
  // without it, so the runner passes whatever the seed produced.
  anchor?: ChatAnchor
  // Present for briefing_annotation only: what the runner hands
  // POST /v1/briefing-chats, the route that creates a briefing conversation
  // together with its annotation.
  briefing?: BriefingChatTarget
}

export interface BriefingChatTarget {
  // yyyy-MM-dd, the form the briefing route takes.
  meetingDate: string
  anchor: BriefingChatAnchor
}

export interface SeedChatOrgOptions {
  // Which step of the ordinance flow the anchor opens on. Tools register off
  // the step, so this is the only way to reach the five steps past clarify —
  // authority, current_law, comparables, draft and review each carry their
  // own present_* tools and nothing else does. Defaults to `clarify` so every
  // existing caller seeds exactly what it seeded before.
  step?: OrdinanceFlowStep
  // EVERY ONE OF THESE DEFAULTS TO WHAT THE SEEDER ALREADY SEEDED, so a
  // caller that passes none gets byte-identical state to before. Only an
  // explicit `false` takes something away. See ChatAccountStateSchema for
  // what each one gates and why these are the states worth naming.
  pro?: boolean
  district?: boolean
  campaignDetails?: boolean
  // Opens a briefing chat on a highlighted passage rather than the whole
  // briefing. The one option whose default is absence: see cases.ts.
  briefingHighlight?: boolean
}

// Which account states a scope can actually express. A state the scope has no
// row for cannot be seeded, and seeding nothing while recording the directive
// would put a condition on the record that the agent was never under.
//
// `district` is on every scope: all five seed an organization, and
// `positionId` is a column on it. Each scope resolves its district from its
// own organization — briefing chat from the briefing's office's org, which is
// the one this case seeded. The other states need a campaign row or an
// anchor, which only one scope each has.
//
// Partial, and a missing entry means "expresses nothing", which refuses every
// state. `chatScopeFor` has already narrowed the caller to the scopes the
// runner can drive, so the fallback is only reachable if another scope is
// registered there without being described here — and refusing is the right
// answer to that.
const STATES_BY_SCOPE: Partial<
  Record<ChatScope, readonly (keyof ChatAccountState)[]>
> = {
  [ChatScope.campaign_assistant]: ['district', 'pro', 'campaignDetails'],
  [ChatScope.ordinance_flow]: ['district', 'ordinanceStep'],
  [ChatScope.priority_flow]: ['district'],
  [ChatScope.chief_of_staff]: ['district'],
  [ChatScope.briefing_annotation]: ['district', 'briefingHighlight'],
}

// REFUSES RATHER THAN PROCEEDING, and before anything is seeded — which is
// before the conversation is opened and long before a turn is driven, so an
// unhonourable directive costs nothing.
//
// The schema's `.strict()` already refuses a state nobody defined. This is the
// other half: a state that IS defined but means nothing for this scope, such
// as asking a Chief of Staff office to lose Pro when no campaign row exists to
// carry the flag.
export const assertAccountStateSupported = (
  agentId: string,
  state?: ChatAccountState,
): void => {
  if (state === undefined) return
  const scope = chatScopeFor(agentId)
  const allowed = new Set<string>(STATES_BY_SCOPE[scope] ?? [])
  const unsupported = Object.keys(state).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) {
    throw new CaseListError(
      `${agentId} cannot express the account state ` +
        `${unsupported.sort().join(', ')}: the ${scope} seed has no row ` +
        `that carries it, and the states it can express are ` +
        `${[...allowed].sort().join(', ')}`,
    )
  }
}

export const seedOptionsFor = (
  agentId: string,
  state?: ChatAccountState,
): SeedChatOrgOptions => {
  assertAccountStateSupported(agentId, state)
  if (state === undefined) return {}
  return {
    ...(state.ordinanceStep !== undefined && { step: state.ordinanceStep }),
    ...(state.pro !== undefined && { pro: state.pro }),
    ...(state.district !== undefined && { district: state.district }),
    ...(state.campaignDetails !== undefined && {
      campaignDetails: state.campaignDetails,
    }),
    ...(state.briefingHighlight !== undefined && {
      briefingHighlight: state.briefingHighlight,
    }),
  }
}

// THE DISTRICT GATE IS HALF OURS AND HALF NOT, and this is the half that is.
//
// `organization.positionId` does not point at a row in this database. It holds
// an election-db position id, and DistrictResolverService resolves it through
// ElectionsService.getPositionById, a read of the separate election database,
// so there is no position or district table here that seeding could fill. What
// IS ours is the precondition: resolveByOrgSlug returns null on a missing
// positionId BEFORE it asks election-db at all, which is why districtFilters
// was null no matter what else was configured.
//
// JUDGE_POSITION is that reply, exported rather than written out at each call
// site so the seeded id and the stubbed position cannot drift apart. A test
// re-spies ElectionsService.getPositionById with it, which is what
// test-service asks a suite needing a real position to do. A deployment that
// can reach election-db needs no stub, and one that cannot cannot be given a
// district by any amount of seeding.
//
// NO `overrideDistrictId` on purpose. resolveDistrict takes
// `overrideDistrict ?? position.district`, so an override id would beat this
// position's own district — and it would be answered by useTestService's
// getDistrict stub, whose district is in IL while the state still came from
// the position, in WA. The mandatory filters would then bind a WA state to an
// IL district: a scope that matches nothing, assembled from two sources that
// were never meant to be read together. The district travels with the
// position, which is also the ordinary production path.
const JUDGE_POSITION_ID = 'judge-position-1'

export const JUDGE_POSITION: PositionWithOptionalDistrict = {
  id: JUDGE_POSITION_ID,
  brPositionId: 'br-judge-position-1',
  brDatabaseId: 'br-db-judge-position-1',
  state: 'WA',
  name: 'Council Member',
  level: 'CITY',
  district: {
    id: 'judge-district-1',
    state: 'WA',
    L2DistrictType: 'City Council',
    L2DistrictName: 'Judge City Council District 1',
  },
}

// The campaign `details` blob, lifted to a constant so the
// `campaignDetails: false` state is the ABSENCE of this exact object rather
// than a second, thinner copy of it that would drift out of step with it.
//
// Only the keys campaignManager.handler.ts really reads off this column.
// `raceId` is the one get_ballot_requirements registers on; the office, state,
// city, level and district are what the prompt renders; the two election dates
// and two filing dates are what the race block's dates and counts are
// rendered from.
//
// FIXED DATES, not dates relative to now: both arms of a comparison must
// render the same system prompt when the branch changed nothing the agent can
// see, and a date derived from the clock differs between two arms captured
// hours apart — which would make every configDigest differ and permanently
// disarm the identical-config refusal. The counts they produce go negative as
// these dates pass, which is a real state (a candidate whose election is
// behind them) and is the trade taken for a stable digest.
const JUDGE_CAMPAIGN_DETAILS = {
  normalizedOffice: 'City Council',
  ballotLevel: 'CITY',
  district: 'District 1',
  state: 'WA',
  city: 'Judge City',
  electionDate: '2027-11-02',
  primaryElectionDate: '2027-08-03',
  filingPeriodsStart: '2027-05-10',
  filingPeriodsEnd: '2027-05-21',
  raceId: 'judge-race-1',
} satisfies PrismaJson.CampaignDetails

const CHAT_AGENT_SCOPES: Record<string, ChatScope> = {
  chief_of_staff: ChatScope.chief_of_staff,
  campaign_assistant: ChatScope.campaign_assistant,
  ordinance_flow: ChatScope.ordinance_flow,
  priority_flow: ChatScope.priority_flow,
  briefing_annotation: ChatScope.briefing_annotation,
}

export const chatScopeFor = (agentId: string): ChatScope => {
  const scope = CHAT_AGENT_SCOPES[agentId]
  if (!scope) {
    throw new Error(
      `"${agentId}" is not a chat scope the runner can drive; the ` +
        `registered scopes are ${Object.keys(CHAT_AGENT_SCOPES).join(', ')}`,
    )
  }
  return scope
}

// Shortened with a digest of the whole input rather than by cutting the end
// off it. `organization.slug` is the table's primary key and the attempt
// number is the last thing in the input, so a plain slice gave every attempt
// of a long case id one slug and the second attempt died on the key.
const slugify = (value: string): string => {
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 31)
    .replace(/-$/, '')
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8)
  return `${readable}-${digest}`
}

// Derived, not randomised, and a pure function of its two arguments so that
// attempt i of both arms seeds the same slug. A slug that differed between
// arms would reach the system prompt and make every configDigest differ,
// permanently disarming the orchestrator's identical-config refusal.
export const chatOrgSlug = (agentId: string, slugKey: string): string =>
  `judge-${slugify(`${agentId}-${slugKey}`)}`

const snapshotFor = (title: string) => ({
  title,
  summary: `Judge fixture for ${title}.`,
})

// `slugKey` is the caller's case id: unique per case within one run, and the
// same on both arms.
export const seedChatOrg = async (
  prisma: PrismaClient,
  userId: number,
  agentId: string,
  slugKey: string,
  options: SeedChatOrgOptions = {},
): Promise<SeededChatOrg> => {
  // Inserts against whatever client it is handed, and the briefing seed also
  // deletes (see seedBriefing). A judge-prefixed organization owned by a real
  // user is not something to create outside a throwaway database.
  assertTestProcess('seedChatOrg')
  const scope = chatScopeFor(agentId)
  const organizationSlug = chatOrgSlug(agentId, slugKey)
  // Omitted rather than nulled when a case asked for no district: a missing
  // positionId is the production state, and resolveByOrgSlug refuses on it
  // before it asks election-db anything.
  const position =
    options.district === false ? {} : { positionId: JUDGE_POSITION_ID }

  if (scope === ChatScope.campaign_assistant) {
    await prisma.organization.create({
      data: {
        slug: organizationSlug,
        ownerId: userId,
        ...position,
      },
    })
    await prisma.campaign.create({
      data: {
        organizationSlug,
        slug: organizationSlug,
        userId,
        // The whole voter-file family is gated on `ctx.isPro !== false`, and
        // the column defaults to false — so a campaign created without this
        // reached the model with three tools and the filing and voter-file
        // questions measured the upgrade prompt instead of the data path.
        isPro: options.pro !== false,
        // Absent when a case asked for a campaign with no details: the column
        // defaults to an empty object, `raceId` is then null and
        // get_ballot_requirements does not register. See
        // JUDGE_CAMPAIGN_DETAILS for what the keys buy.
        ...(options.campaignDetails === false
          ? {}
          : { details: JUDGE_CAMPAIGN_DETAILS }),
      },
    })
    return { organizationSlug }
  }

  await prisma.organization.create({
    data: {
      slug: organizationSlug,
      ownerId: userId,
      customPositionName: 'Council Member',
      ...position,
    },
  })
  const electedOffice = await prisma.electedOffice.create({
    data: { organizationSlug, userId },
  })

  if (scope === ChatScope.ordinance_flow) {
    const ordinance = await prisma.ordinance.create({
      data: {
        electedOfficeId: electedOffice.id,
        seedType: OrdinanceSeedType.new,
        goalText: 'Require covered bicycle parking at new multifamily builds.',
      },
    })
    // The agent's own municipality, and the ONLY source of it that does not
    // need election-db: OrdinanceFlowContextService reads this row by the
    // office's organizationSlug and renders `place, state` as the
    // jurisdiction, while the handler's district resolver only overrides it.
    // Without it the agent does not know which city it is drafting for on
    // every step, and get_code_source answers `no_record`.
    //
    // NO TOOL IS GATED ON IT. Jurisdiction is a prompt input, not a
    // registration condition, so this changes what the authority, current_law
    // and comparables steps can reason about rather than which tools they
    // have.
    await prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug,
        // `codeFound` must be true or the context service's findFirst skips
        // the row and the jurisdiction stays null.
        codeFound: true,
        dataQuality: OrdinanceDataQuality.OK,
        confidence: OrdinanceConfidence.HIGH,
        hostType: OrdinanceHostType.MUNICODE,
        url: 'https://library.municode.com/wa/judge_city/codes/code_of_ordinances',
        editionOrDate: 'Supp. 1',
        place: 'Judge City',
        state: 'WA',
        verifiedEvidence: 'Judge fixture: a code source nobody has to verify.',
        // A bucket and key that resolve to nothing. readArtifactToc returns no
        // table of contents for them, which is the same answer a real record
        // whose artifact has expired gives.
        artifactBucket: 'judge-fixture-bucket',
        artifactKey: `judge-fixture/${organizationSlug}/toc.json`,
        verifiedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    })
    return {
      organizationSlug,
      electedOfficeId: electedOffice.id,
      anchor: {
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        url: `https://goodparty.org/ordinances/${ordinance.slug}`,
        snapshot: snapshotFor('Bicycle parking ordinance'),
        step: options.step ?? 'clarify',
      },
    }
  }

  if (scope === ChatScope.priority_flow) {
    const priority = await prisma.priority.create({
      data: {
        electedOfficeId: electedOffice.id,
        title: 'Affordable housing',
        description: 'Expand the supply of affordable housing downtown.',
        source: PrioritySource.user_stated,
      },
    })
    return {
      organizationSlug,
      electedOfficeId: electedOffice.id,
      anchor: {
        resourceType: 'priority',
        resourceId: priority.id,
        url: `https://goodparty.org/priorities/${priority.id}`,
        snapshot: snapshotFor('Affordable housing'),
      },
    }
  }

  if (scope === ChatScope.briefing_annotation) {
    return {
      organizationSlug,
      electedOfficeId: electedOffice.id,
      briefing: await seedBriefing(
        prisma,
        userId,
        organizationSlug,
        electedOffice.id,
        options,
      ),
    }
  }

  return { organizationSlug, electedOfficeId: electedOffice.id }
}

// THE MEETING BRIEFING A briefing chat is opened on, plus the one note that
// registers get_my_notes. The artifact itself is not in this database: the
// row names a bucket and key, and the artifact seam in chatSeam.ts answers
// that bucket with the fixture, because production reads it from S3.
//
// THE ONE DELETE IN THIS FILE, and why it is needed. POST /v1/briefing-chats
// finds the briefing by (meetingDate, the caller's elected office), and
// production assumes one office per user — but an arm seeds an office per case
// for one judge user, all on the same fixed meeting date. Left alone, the
// route would resolve case two to case one's briefing, and since a top-level
// chat is find-or-create per briefing, case two would CONTINUE case one's
// conversation. So the previous cases' judge briefings on this date are
// removed first. Chat cases walk one at a time (sweepArm.walkCases), every
// earlier record is already written, and nothing reads those rows again.
const seedBriefing = async (
  prisma: PrismaClient,
  userId: number,
  organizationSlug: string,
  electedOfficeId: string,
  options: SeedChatOrgOptions,
): Promise<BriefingChatTarget> => {
  const meetingDate = parseIsoDateAsUTC(JUDGE_MEETING_DATE)
  await prisma.meetingBriefing.deleteMany({
    where: {
      meetingDate,
      electedOffice: { userId, organizationSlug: { startsWith: 'judge-' } },
    },
  })
  // MeetingBriefing requires the run that produced it.
  const run = await prisma.experimentRun.create({
    data: {
      organizationSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  const briefing = await prisma.meetingBriefing.create({
    data: {
      electedOfficeId,
      meetingDate,
      meetingTime: JUDGE_MEETING_TIME,
      meetingTimezone: JUDGE_MEETING_TIMEZONE,
      experimentRunId: run.runId,
      artifactBucket: JUDGE_BRIEFING_BUCKET,
      artifactKey: judgeBriefingKey(organizationSlug),
    },
  })
  const note = await prisma.annotationNote.create({
    data: { body: JUDGE_NOTE.body },
  })
  await prisma.annotation.create({
    data: {
      authorUserId: userId,
      kind: AnnotationKind.note,
      resourceId: briefing.id,
      resourceType: AnnotationResourceType.briefing,
      ...JUDGE_NOTE.anchor,
      noteId: note.id,
    },
  })
  return {
    meetingDate: JUDGE_MEETING_DATE,
    anchor: options.briefingHighlight
      ? JUDGE_HIGHLIGHT_ANCHOR
      : TOP_LEVEL_ANCHOR,
  }
}
