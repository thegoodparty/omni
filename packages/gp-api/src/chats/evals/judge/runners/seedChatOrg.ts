import { createHash } from 'node:crypto'
import type { ChatAnchor, OrdinanceFlowStep } from '@goodparty_org/contracts'
import {
  ChatScope,
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
  OrdinanceSeedType,
  PrioritySource,
  type PrismaClient,
} from '../../../../generated/prisma'
import type { PositionWithOptionalDistrict } from '@/elections/types/elections.types'
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

export interface SeededChatOrg {
  organizationSlug: string
  electedOfficeId?: string
  // Present for the two anchor-keyed scopes. POST /v1/chats rejects those
  // without it, so the runner passes whatever the seed produced.
  anchor?: ChatAnchor
}

export interface SeedChatOrgOptions {
  // Which step of the ordinance flow the anchor opens on. Tools register off
  // the step, so this is the only way to reach the five steps past clarify —
  // authority, current_law, comparables, draft and review each carry their
  // own present_* tools and nothing else does. Defaults to `clarify` so every
  // existing caller seeds exactly what it seeded before.
  step?: OrdinanceFlowStep
}

// THE DISTRICT GATE IS HALF OURS AND HALF NOT, and this is the half that is.
//
// `organization.positionId` does not point at a row in this database. It holds
// an election-api position id, and DistrictResolverService resolves it with an
// HTTP GET (ElectionsService.getPositionById, which is `electionApiGet`), so
// there is no position or district table here that seeding could fill. What IS
// ours is the precondition: resolveByOrgSlug returns null on a missing
// positionId BEFORE it asks election-api at all, which is why districtFilters
// was null no matter what else was configured.
//
// JUDGE_POSITION is that reply, exported rather than written out at each call
// site so the seeded id and the stubbed position cannot drift apart. A test
// re-spies ElectionsService.getPositionById with it, which is what
// test-service asks a suite needing a real position to do. A deployment that
// can reach election-api needs no stub, and one that cannot cannot be given a
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

const CHAT_AGENT_SCOPES: Record<string, ChatScope> = {
  chief_of_staff: ChatScope.chief_of_staff,
  campaign_assistant: ChatScope.campaign_assistant,
  ordinance_flow: ChatScope.ordinance_flow,
  priority_flow: ChatScope.priority_flow,
}

export const chatScopeFor = (agentId: string): ChatScope => {
  const scope = CHAT_AGENT_SCOPES[agentId]
  if (!scope) {
    throw new Error(
      `"${agentId}" is not a chat scope the runner can drive; the four ` +
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
  // Inserts against whatever client it is handed. Nothing here deletes, but a
  // judge-prefixed organization owned by a real user is still not something
  // to create outside a throwaway database.
  assertTestProcess('seedChatOrg')
  const scope = chatScopeFor(agentId)
  const organizationSlug = chatOrgSlug(agentId, slugKey)

  if (scope === ChatScope.campaign_assistant) {
    await prisma.organization.create({
      data: {
        slug: organizationSlug,
        ownerId: userId,
        positionId: JUDGE_POSITION_ID,
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
        isPro: true,
        // Only the keys campaignManager.handler.ts really reads off this
        // column. `raceId` is the one get_ballot_requirements registers on;
        // the office, state, city, level and district are what the prompt
        // renders; the two election dates and two filing dates are what
        // weeksToElection and daysToFilingDeadline are computed from.
        //
        // FIXED DATES, not dates relative to now: both arms of a comparison
        // must render the same system prompt when the branch changed nothing
        // the agent can see, and a date derived from the clock differs
        // between two arms captured hours apart — which would make every
        // configDigest differ and permanently disarm the identical-config
        // refusal. The counts they produce go negative as these dates pass,
        // which is a real state (a candidate whose election is behind them)
        // and is the trade taken for a stable digest.
        details: {
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
        },
      },
    })
    return { organizationSlug }
  }

  await prisma.organization.create({
    data: {
      slug: organizationSlug,
      ownerId: userId,
      customPositionName: 'Council Member',
      positionId: JUDGE_POSITION_ID,
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
    // need election-api: OrdinanceFlowContextService reads this row by the
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

  return { organizationSlug, electedOfficeId: electedOffice.id }
}
