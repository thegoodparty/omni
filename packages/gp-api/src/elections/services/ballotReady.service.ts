import { Injectable, InternalServerErrorException } from '@nestjs/common'
import {
  addMonths,
  compareAsc,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { gql, GraphQLClient } from 'graphql-request'
import { Headers, MimeTypes } from 'http-constants-ts'
import { PositionLevel } from 'src/generated/graphql.types'
import { parseIsoDateAsUTC } from 'src/shared/util/date.util'
import { truncateZip } from 'src/shared/util/zipcodes.util'
import zipcodes from 'zipcodes'
import {
  BallotReadyMilestone,
  PersonOfficeHolder,
  PersonWithOfficeHolders,
  RaceMilestonesGraphResponse,
  RaceNode,
  RacesByIdNode,
  RacesByZipcode,
  RacesWithElectionDates,
  RaceWithOfficeHolders,
  RaceWithOfficeHoldersNode,
} from '../types/ballotReady.types'
import type { MilestoneWindow, RaceMilestones } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'

const API_BASE = 'https://bpi.civicengine.com/graphql'
const BALLOT_READY_KEY = process.env.BALLOT_READY_KEY
if (!BALLOT_READY_KEY) {
  throw new InternalServerErrorException(
    'Please set BALLOT_READY_KEY in your .env',
  )
}

const headers = {
  [Headers.AUTHORIZATION]: `Bearer ${BALLOT_READY_KEY}`,
  [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
}

// BallotReady Node IDs are base64(url) encodings of `gid://...`. Reject anything
// outside that alphabet before use — defense-in-depth on top of passing the id
// as a typed GraphQL variable, so a stored campaign.details.raceId can never
// carry query-breaking characters (CWE-943).
const BALLOT_READY_ID_RE = /^[A-Za-z0-9+/=_-]+$/
const isValidBallotReadyId = (id: string): boolean =>
  BALLOT_READY_ID_RE.test(id)

// filterBy.level is a GraphQL enum identifier, not a value — it cannot be passed
// as a string variable, so validate each token against the known PositionLevel
// set before it is interpolated into a query.
const VALID_POSITION_LEVELS = new Set<string>(Object.values(PositionLevel))

// A requested level expands to these PositionLevel enum tokens. Keyed/valued by
// the enum so it can't drift, but used as plain string lookups (never an
// enum-vs-string comparison).
const LEVEL_EXPANSIONS: Record<string, string[]> = {
  [PositionLevel.LOCAL]: [
    PositionLevel.LOCAL,
    PositionLevel.TOWNSHIP,
    PositionLevel.CITY,
  ],
  [PositionLevel.COUNTY]: [PositionLevel.COUNTY, PositionLevel.REGIONAL],
}

const MALFORMED_RACE_ID_LOG = 'Rejecting malformed BallotReady race id'

@Injectable()
export class BallotReadyService {
  private readonly graphQLClient = new GraphQLClient(API_BASE, {
    headers,
  })

  async fetchRaceNormalizedPosition(raceId: string) {
    if (!isValidBallotReadyId(raceId)) {
      this.logger.error({ raceId }, MALFORMED_RACE_ID_LOG)
      return null
    }
    // Pass the id as a typed variable — never string-interpolate it (CWE-943).
    const query = gql`
      query GetNormalizedPosition($id: ID!) {
        node(id: $id) {
          ... on Position {
            normalizedPosition {
              name
            }
          }
        }
      }
    `
    try {
      const result = await this.graphQLClient.request<{
        node: {
          normalizedPosition: {
            name: string
          } | null
        } | null
      }>(query, { id: raceId })
      return result?.node?.normalizedPosition?.name ?? null
    } catch (error) {
      this.logger.error(
        { error },
        `Error at getNormalizedPosition for id ${raceId}:`,
      )
      return null
    }
  }

  async fetchRaceById(raceId: string): Promise<RacesByIdNode | null> {
    if (!isValidBallotReadyId(raceId)) {
      this.logger.error({ raceId }, MALFORMED_RACE_ID_LOG)
      return null
    }
    const query = gql`
      query Node($id: ID!) {
        node(id: $id) {
          ... on Race {
            databaseId
            isPartisan
            isPrimary
            election {
              electionDay
              name
              state
            }
            position {
              id
              description
              judicial
              level
              name
              partisanType
              staggeredTerm
              state
              subAreaName
              subAreaValue
              tier
              mtfcc
              geoId
              electionFrequencies {
                frequency
              }
              hasPrimary
              normalizedPosition {
                name
              }
            }
            filingPeriods {
              endOn
              startOn
            }
          }
        }
      }
    `

    try {
      return await this.graphQLClient.request(query, { id: raceId })
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchRaceById:')
      return null
    }
  }

  // Hop from a general-election race to its sibling primary race, returning
  // the primary's brHashId (the id election-api keys campaign-strategy-context
  // on). Returns null when the position has no primary or none can be found.
  async fetchPrimaryRaceId(generalRaceId: string): Promise<string | null> {
    const race = await this.fetchRaceById(generalRaceId)
    const positionId = race?.node?.position?.id
    // electionDay is an ISO8601Date GraphQL scalar (typed `any`); coerce.
    const generalDay = String(race?.node?.election?.electionDay ?? '')
    if (!positionId || !race?.node?.position?.hasPrimary || !generalDay) {
      return null
    }
    const year = generalDay.slice(0, 4)
    const query = gql`
      query PrimaryRaceForPosition(
        $positionId: ID!
        $rangeStart: ISO8601Date!
        $rangeEnd: ISO8601Date!
      ) {
        node(id: $positionId) {
          ... on Position {
            races(
              filterBy: { electionDay: { gte: $rangeStart, lte: $rangeEnd } }
              first: 50
            ) {
              edges {
                node {
                  id
                  isPrimary
                  election {
                    electionDay
                  }
                }
              }
            }
          }
        }
      }
    `
    try {
      const result = await this.graphQLClient.request<
        {
          node: {
            races?: {
              edges: {
                node: {
                  id: string
                  isPrimary: boolean
                  election: { electionDay: string }
                }
              }[]
            }
          } | null
        },
        { positionId: string; rangeStart: string; rangeEnd: string }
      >(query, {
        positionId,
        rangeStart: `${year}-01-01`,
        rangeEnd: `${year}-12-31`,
      })
      const primary = (result?.node?.races?.edges ?? [])
        .map((e) => e.node)
        .filter((n) => n.isPrimary && n.election.electionDay !== generalDay)
        .sort((a, b) =>
          String(a.election.electionDay).localeCompare(
            String(b.election.electionDay),
          ),
        )[0]
      return primary?.id ?? null
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchPrimaryRaceId:')
      return null
    }
  }

  async fetchRaceByPositionAndDate(params: {
    brPositionId: string
    electionDate: string
  }): Promise<RaceNode | null> {
    const { brPositionId, electionDate } = params
    const year = electionDate.slice(0, 4)
    const rangeStart = `${year}-01-01`
    const rangeEnd = `${year}-12-31`
    const query = gql`
      query RaceByPositionAndDate(
        $positionId: ID!
        $rangeStart: ISO8601Date!
        $rangeEnd: ISO8601Date!
      ) {
        node(id: $positionId) {
          ... on Position {
            races(
              filterBy: { electionDay: { gte: $rangeStart, lte: $rangeEnd } }
              first: 50
            ) {
              edges {
                node {
                  id
                  isPrimary
                  filingPeriods {
                    startOn
                    endOn
                  }
                  election {
                    id
                    electionDay
                    name
                    originalElectionDate
                    state
                    timezone
                  }
                  position {
                    id
                    appointed
                    geoId
                    mtfcc
                    hasPrimary
                    partisanType
                    level
                    name
                    salary
                    state
                    subAreaName
                    subAreaValue
                    electionFrequencies {
                      frequency
                    }
                    normalizedPosition {
                      name
                    }
                    tier
                  }
                }
              }
            }
          }
        }
      }
    `
    try {
      const result = await this.graphQLClient.request<
        {
          node: {
            races?: { edges: { node: RaceNode }[] }
          } | null
        },
        { positionId: string; rangeStart: string; rangeEnd: string }
      >(query, {
        positionId: brPositionId,
        rangeStart,
        rangeEnd,
      })
      const edges = result?.node?.races?.edges ?? []
      const target = edges.find(
        (e) => e.node.election.electionDay === electionDate,
      )?.node
      if (!target) {
        return null
      }
      const primary = edges
        .filter(
          (e) =>
            e.node.isPrimary && e.node.election.electionDay !== electionDate,
        )
        .map((e) => e.node)
        .sort((a, b) =>
          String(a.election.electionDay).localeCompare(
            String(b.election.electionDay),
          ),
        )[0]
      if (primary) {
        target.election.primaryElectionDate = String(
          primary.election.electionDay,
        )
        target.election.primaryElectionId = String(primary.election.id)
      }
      return target
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchRaceByPositionAndDate:')
      throw error
    }
  }

  async fetchRacesByZipcode(
    zipcode: string,
    level?: string | null,
    electionDate?: string | null,
    startCursor?: string | null,
  ): Promise<RacesByZipcode | null> {
    let gt: string
    let lt: string
    if (electionDate) {
      ;({ gt, lt } = getMonthBounds(electionDate))
    } else {
      gt = new Date().toISOString().split('T')[0] ?? ''
      const nextYear = new Date()
      nextYear.setFullYear(nextYear.getFullYear() + 2)
      lt = nextYear.toISOString().split('T')[0] ?? ''
    }
    // zipcodes.lookup returns a 2-letter US abbreviation (or nothing); pin that
    // shape before inlining so only [A-Z]{2} can ever reach the query.
    const lookedUpState = zipcodes.lookup(zipcode)?.state
    const state =
      lookedUpState && /^[A-Z]{2}$/.test(lookedUpState) ? lookedUpState : null

    const levelTokens = this.resolveLevelTokens(level)

    const query = gql`
    query RacesByZipcode(
      $zip: String!
      $gte: ISO8601Date!
      $lte: ISO8601Date!
      $after: String
    ) {
      races(
        location: { zip: $zip }
        filterBy: {
          electionDay: { gte: $gte, lte: $lte }
          ${state ? `state: "${state}"` : ''}
          ${levelTokens ? `level: [${levelTokens}]` : ''}
        }
        after: $after
        first: 100
      ) {
        edges {
          node {
            id
            isPrimary
            election {
              id
              electionDay
              name
              originalElectionDate
              state
              timezone
            }
            position {
              id
              appointed
              geoId
              mtfcc
              hasPrimary
              partisanType
              level
              name
              salary
              state
              subAreaName
              subAreaValue
              electionFrequencies {
                frequency
              }
            }
            filingPeriods {
              startOn
              endOn
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
          startCursor
        }
      }
    }
    `
    try {
      return await this.graphQLClient.request(query, {
        zip: truncateZip(zipcode),
        gte: gt,
        lte: lt,
        after: startCursor ?? null,
      })
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchRacesByZipcode: ')
      return null
    }
  }

  // Map a requested level to its BallotReady PositionLevel enum tokens, dropping
  // the filter entirely if any token is not a recognised enum value. These are
  // GraphQL enum identifiers (interpolated, not variables), so validating them
  // against the known set is what prevents injection on this path.
  private resolveLevelTokens(level?: string | null): string | null {
    const upper = level?.toUpperCase()
    if (!upper) return null
    const tokens = LEVEL_EXPANSIONS[upper] ?? [upper]
    if (!tokens.every((token) => VALID_POSITION_LEVELS.has(token))) {
      this.logger.error({ level }, 'Rejecting unrecognised BallotReady level')
      return null
    }
    return tokens.join(',')
  }

  async fetchRacesWithElectionDates(
    zipcode: string,
    positionLevel: PositionLevel,
  ): Promise<RacesWithElectionDates | null> {
    if (!VALID_POSITION_LEVELS.has(positionLevel)) {
      this.logger.error(
        { positionLevel },
        'Rejecting unrecognised BallotReady position level',
      )
      return null
    }
    const today = new Date().toISOString().split('T')[0]

    // zip and the upper date bound are typed variables; level is a validated
    // enum identifier (above), so interpolating it here cannot inject.
    const query = gql`
            query RacesWithElectionDates($zip: String!, $lt: ISO8601Date!) {
                races(
                    location: { zip: $zip }
                    filterBy: { electionDay: { gt: "2006-01-01", lt: $lt }, level: ${positionLevel} }
                ) {
                    edges {
                        node {
                            position {
                                name
                            }
                            election {
                                electionDay
                            }
                        }
                    }
                }
            }`

    try {
      return await this.graphQLClient.request(query, {
        zip: truncateZip(zipcode),
        lt: today,
      })
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchRacesWithElectionDates: ')
      return null
    }
  }

  async fetchRacesWithOfficeHolders(
    raceId: string,
  ): Promise<RaceWithOfficeHoldersNode | null> {
    if (!isValidBallotReadyId(raceId)) {
      this.logger.error({ raceId }, MALFORMED_RACE_ID_LOG)
      return null
    }
    const query = gql`
      query Node($id: ID!) {
        node(id: $id) {
          ... on Race {
            databaseId
            isPartisan
            isPrimary
            election {
              electionDay
              name
              state
            }
            position {
              id
              description
              judicial
              level
              name
              partisanType
              staggeredTerm
              state
              seats
              subAreaName
              subAreaValue
              tier
              mtfcc
              geoId
              electionFrequencies {
                frequency
              }
              hasPrimary
              normalizedPosition {
                name
              }
              officeHolders {
                nodes {
                  centralPhone
                  createdAt
                  databaseId
                  endAt
                  id
                  isAppointed
                  isCurrent
                  isOffCycle
                  isVacant
                  officePhone
                  officeTitle
                  otherPhone
                  primaryEmail
                  specificity
                  startAt
                  totalYearsInOffice
                  updatedAt
                  person {
                    createdAt
                    databaseId
                    email
                    firstName
                    fullName
                    id
                    lastName
                    middleName
                    nickname
                    phone
                    slug
                    suffix
                    updatedAt
                  }
                }
              }
            }
            filingPeriods {
              endOn
              startOn
            }
            candidacies {
              createdAt
              databaseId
              id
              isCertified
              isHidden
              result
              uncertified
              updatedAt
              withdrawn
              candidate {
                createdAt
                databaseId
                email
                firstName
                fullName
                id
                lastName
                middleName
                nickname
                phone
                slug
                suffix
                updatedAt
              }
              election {
                electionDay
              }
            }
          }
        }
      }
    `

    try {
      const response = await this.graphQLClient.request<RaceWithOfficeHolders>(
        query,
        { id: raceId },
      )
      return response?.node || null
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchRacesWithOfficeHolders:')
      return null
    }
  }

  /**
   * Fetch every office-holder record BR has for a given person (by BR node id),
   * including the position and term boundaries (startAt / endAt). Used to
   * pre-fill an elected office at magic-link time. Returns null on any failure
   * so the caller can fall back to asking the user.
   */
  async fetchPersonOfficeHolders(
    personId: string,
  ): Promise<PersonOfficeHolder[] | null> {
    if (!isValidBallotReadyId(personId)) {
      this.logger.error({ personId }, 'Rejecting malformed BallotReady id')
      return null
    }
    const query = gql`
      query PersonOfficeHolders($personId: ID!) {
        node(id: $personId) {
          ... on Person {
            id
            databaseId
            fullName
            officeHolders {
              nodes {
                id
                databaseId
                startAt
                endAt
                isCurrent
                isVacant
                officeTitle
                position {
                  id
                  databaseId
                  name
                  level
                  state
                  subAreaName
                  subAreaValue
                  electionFrequencies {
                    frequency
                  }
                }
              }
            }
          }
        }
      }
    `

    try {
      const response =
        await this.graphQLClient.request<PersonWithOfficeHolders>(query, {
          personId,
        })
      return response?.node?.officeHolders?.nodes ?? null
    } catch (error) {
      this.logger.error({ error }, 'Error at fetchPersonOfficeHolders:')
      return null
    }
  }

  // Fetch the per-category milestone windows for a BR race. Source:
  // Race.election.milestones() — BR returns one row per (category, type,
  // feature), so we collapse via earliest OPEN / latest CLOSE per
  // category. Returns null on any failure so callers can null-fill the
  // field without failing the parent request — milestones are enrichment,
  // not core.
  //
  // Field name `date` (not `at`) confirmed via GraphQL introspection
  // 2026-06-01. BR's Milestone.date is ISO8601Date (yyyy-MM-dd), so the
  // datetime/offset gymnastics we needed for the original `at` guess are
  // unnecessary — string sort matches chronological order for
  // ISO8601Date and the value never needs reformatting.
  async fetchMilestones(brHashId: string): Promise<RaceMilestones | null> {
    if (!brHashId || !isValidBallotReadyId(brHashId)) return null
    const query = gql`
      query MilestonesForRace($raceId: ID!) {
        node(id: $raceId) {
          ... on Race {
            election {
              milestones {
                category
                type
                date
              }
            }
          }
        }
      }
    `
    try {
      const result = await this.graphQLClient.request<
        RaceMilestonesGraphResponse,
        { raceId: string }
      >(query, { raceId: brHashId })
      // No race (unknown raceId) or no linked Election → no data to
      // collapse. Return top-level null so callers can null-fill cleanly
      // and don't conflate "race not found" with "election exists but
      // returned zero milestones" (which yields an all-null-windows
      // object via collapseMilestones below).
      if (!result?.node?.election) return null
      const milestones = result.node.election.milestones ?? []
      return collapseMilestones(milestones)
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'BR Race.election.milestones lookup failed',
      )
      return null
    }
  }

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(BallotReadyService.name)
  }
}

// Group BR milestones by category, picking the earliest OPEN and latest
// CLOSE per category. BR returns one row per (category, type, feature)
// combo — e.g. REGISTRATION CLOSE has separate rows for IN_PERSON, MAIL,
// ONLINE deadlines. Earliest OPEN captures the first opportunity to
// register/vote; latest CLOSE captures the final deadline a voter can
// still hit (matters because some states close ONLINE earlier than
// IN_PERSON). UI consumers can render the window without reasoning about
// features. Exported for direct unit testing.
export const collapseMilestones = (
  milestones: BallotReadyMilestone[],
): RaceMilestones => {
  const grouped: Record<string, { opens: string[]; closes: string[] }> = {
    REGISTRATION: { opens: [], closes: [] },
    EARLY_VOTING: { opens: [], closes: [] },
    REQUEST_BALLOT: { opens: [], closes: [] },
  }

  for (const m of milestones) {
    if (!m.date) continue
    const bucket = grouped[m.category]
    if (!bucket) continue
    if (m.type === 'OPEN') bucket.opens.push(m.date)
    else if (m.type === 'CLOSE') bucket.closes.push(m.date)
  }

  return {
    voter_registration: toWindow(grouped.REGISTRATION),
    early_voting: toWindow(grouped.EARLY_VOTING),
    request_ballot: toWindow(grouped.REQUEST_BALLOT),
  }
}

const toWindow = (bucket?: {
  opens: string[]
  closes: string[]
}): MilestoneWindow | null => {
  if (!bucket) return null
  const start = earliestDate(bucket.opens)
  const end = latestDate(bucket.closes)
  if (start === null && end === null) return null
  return { start, end }
}

// BR's Milestone.date is ISO8601Date (yyyy-MM-dd, no time component) per
// schema introspection 2026-06-01. For that format string sort matches
// chronological order, so compareAsc and lex compare give the same
// result here. We keep compareAsc anyway for CLAUDE.md Rule 28 and so
// the helper stays correct if BR ever swaps to the nullable
// `datetime: ISO8601DateTime` field (which can carry a non-UTC offset
// where lex order would diverge from chronological order). The returned
// value is the input string verbatim — no reformatting needed because
// the source is already yyyy-MM-dd.
const earliestDate = (values: string[]): string | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) =>
    compareAsc(parseISO(a), parseISO(b)) <= 0 ? a : b,
  )
}

const latestDate = (values: string[]): string | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) =>
    compareAsc(parseISO(a), parseISO(b)) >= 0 ? a : b,
  )
}

function getMonthBounds(dateString: string): { gt: string; lt: string } {
  const reference = parseISO(dateString)
  return {
    gt: format(startOfMonth(reference), 'yyyy-MM-dd'),
    lt: format(endOfMonth(reference), 'yyyy-MM-dd'),
  }
}

export const FUTURE_OFFICEHOLDER_WINDOW_MONTHS = 3

/**
 * Pick the office-holder record to pre-fill an elected office from. Prefers the
 * soonest upcoming term that starts within FUTURE_OFFICEHOLDER_WINDOW_MONTHS
 * (an elected-but-not-yet-sworn-in lead), otherwise falls back to the current
 * term. Pure function so it can be unit-tested without hitting BR.
 */
export const selectPreferredOfficeHolder = (
  holders: PersonOfficeHolder[],
  now: Date = new Date(),
): PersonOfficeHolder | null => {
  // BallotReady can return isVacant records that still reference the prior
  // holder (e.g. a seat vacated mid-term). Those must never seed an EO pre-fill
  // for a seat the person no longer holds, so drop them before any selection.
  const active = holders.filter((holder) => !holder.isVacant)
  if (!active.length) return null

  const windowEnd = addMonths(now, FUTURE_OFFICEHOLDER_WINDOW_MONTHS)

  const upcoming = active
    .filter((holder): holder is PersonOfficeHolder & { startAt: string } => {
      if (!holder.startAt) return false
      const start = parseIsoDateAsUTC(holder.startAt)
      return start > now && start <= windowEnd
    })
    .sort(
      (a, b) =>
        parseIsoDateAsUTC(a.startAt).getTime() -
        parseIsoDateAsUTC(b.startAt).getTime(),
    )
  const [soonest] = upcoming
  if (soonest) return soonest

  const current =
    active.find((holder) => holder.isCurrent) ??
    active.find((holder) => {
      const start = holder.startAt ? parseIsoDateAsUTC(holder.startAt) : null
      const end = holder.endAt ? parseIsoDateAsUTC(holder.endAt) : null
      // endAt is the exclusive term boundary (the successor's start day), so a
      // holder is current only while now < endAt — matching isHeldOffice and the
      // half-open [start, end) overlap semantics. Using >= would keep selecting
      // the outgoing holder on the successor's first day.
      return (!start || start <= now) && (!end || end > now)
    })
  return current ?? null
}
