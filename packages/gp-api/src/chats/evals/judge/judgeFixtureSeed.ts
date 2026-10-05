import { isEqual, parseISO } from 'date-fns'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  PrioritySource,
  type PrismaClient,
} from '../../../generated/prisma'
import { JUDGE_FIXTURE } from './judgeFixtureIdentity'

// THE DEV ROWS the judge's gp-api-reading agents read, as data. The seed
// script (scripts/seed-judge-fixture.ts) writes exactly this plan, and a test
// pins its shape without a database.
//
// NO CAMPAIGN AND NO WEBSITE, ON PURPOSE. Through the broker's proxy an agent
// can call every @McpTool on gp-api, including the website edit, the domain
// purchase and the Peerly submission. Each of those resolves a campaign from
// the organization slug and 404s without one, so an organization with no
// campaign is what keeps a judge run from writing anything.
//
// Office-agnostic content. Every case names a different real place in its own
// params, and all of them read this one feed, so an issue tied to any one
// city would be wrong for the rest. Both arms read the same rows, which is
// what a comparison needs.

const FIXTURE_OFFICE = 'City Council Member'

export interface JudgeFixturePlan {
  user: {
    clerkId: string
    email: string
    firstName: string
    lastName: string
    name: string
  }
  organization: { slug: string; customPositionName: string }
  electedOffice: {
    organizationSlug: string
    campaignId: null
    swornInDate: Date
    termStartDate: Date
    termEndDate: Date
    onboardingCompletedAt: Date
  }
  priorities: {
    id: string
    title: string
    description: string
    source: PrioritySource
    archivedAt: null
  }[]
  communityIssues: {
    id: string
    organizationSlug: string
    list: CommunityIssueList
    category: CommunityIssueCategory
    priority: CommunityIssuePriority
    title: string
    summary: string
    rank: number
    archivedAt: null
  }[]
}

// Fixed ids, so a second run finds the rows the first one wrote. The issue ids
// are UUIDv7-shaped like the ones gp-api mints, because agents carry them
// forward verbatim.
export const judgeFixturePlan = (): JudgeFixturePlan => ({
  user: {
    clerkId: JUDGE_FIXTURE.clerkUserId,
    email: JUDGE_FIXTURE.email,
    firstName: 'Judge',
    lastName: 'Fixture',
    name: 'Judge Fixture',
  },
  organization: {
    slug: JUDGE_FIXTURE.orgSlug,
    customPositionName: FIXTURE_OFFICE,
  },
  electedOffice: {
    organizationSlug: JUDGE_FIXTURE.orgSlug,
    campaignId: null,
    swornInDate: parseISO('2025-01-06T00:00:00Z'),
    termStartDate: parseISO('2025-01-06T00:00:00Z'),
    termEndDate: parseISO('2029-01-01T00:00:00Z'),
    onboardingCompletedAt: parseISO('2025-01-10T00:00:00Z'),
  },
  priorities: [
    {
      id: 'judge-fixture-priority-1',
      title: 'Repave the worst-rated residential streets first',
      description:
        'Direct the annual paving budget to the residential blocks with the ' +
        'lowest pavement condition scores before arterials that already ' +
        'rate fair or better.',
    },
    {
      id: 'judge-fixture-priority-2',
      title: 'More homes people who work here can afford',
      description:
        'Allow duplexes and small apartment buildings near transit and ' +
        'commercial corridors, and shorten permit review for projects that ' +
        'include income-restricted units.',
    },
    {
      id: 'judge-fixture-priority-3',
      title: 'Faster 911 response in outlying neighborhoods',
      description:
        'Close the gap between citywide and outlying response times by ' +
        'funding a second overnight ambulance crew and reviewing station ' +
        'coverage.',
    },
    {
      id: 'judge-fixture-priority-4',
      title: 'Keep the budget balanced without new fees',
      description:
        'Hold the general fund in balance by reviewing vacant positions and ' +
        'contracts before adding any new resident fees.',
    },
  ].map((priority) => ({
    ...priority,
    source: PrioritySource.user_stated,
    archivedAt: null,
  })),
  communityIssues: [
    {
      id: '01990000-0000-7000-8000-000000000001',
      rank: 1,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.housing_and_development,
      priority: CommunityIssuePriority.high,
      title: 'Rents rising faster than local wages',
      summary:
        'Residents at council comment periods and in letters to the local ' +
        'paper describe rent increases of 10 percent or more at lease ' +
        'renewal, with renters asking what the city can do.',
    },
    {
      id: '01990000-0000-7000-8000-000000000002',
      rank: 2,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.infrastructure_and_transportation,
      priority: CommunityIssuePriority.medium,
      title: 'Potholes and crumbling sidewalks on residential streets',
      summary:
        'Service requests for potholes and broken sidewalks are up from last ' +
        'year, and neighborhood groups say repairs take months.',
    },
    {
      id: '01990000-0000-7000-8000-000000000003',
      rank: 3,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.public_safety,
      priority: CommunityIssuePriority.medium,
      title: 'Speeding through school zones',
      summary:
        'Parents are petitioning for speed humps and crossing guards after ' +
        'several near misses near elementary schools.',
    },
    {
      id: '01990000-0000-7000-8000-000000000004',
      rank: 1,
      list: CommunityIssueList.trending,
      category: CommunityIssueCategory.government_operations,
      priority: CommunityIssuePriority.high,
      title: 'Proposed water and sewer rate increase',
      summary:
        'A proposed rate increase for water and sewer service drew a full ' +
        'room at last week’s public hearing and a run of op-eds.',
    },
    {
      id: '01990000-0000-7000-8000-000000000005',
      rank: 2,
      list: CommunityIssueList.trending,
      category: CommunityIssueCategory.quality_of_life,
      priority: CommunityIssuePriority.medium,
      title: 'Closing hours at the public library branches',
      summary:
        'A plan to close two library branches on weekends has families and ' +
        'students organizing to keep Saturday hours.',
    },
    {
      id: '01990000-0000-7000-8000-000000000006',
      rank: 3,
      list: CommunityIssueList.trending,
      category: CommunityIssueCategory.economic_development,
      priority: CommunityIssuePriority.low,
      title: 'Vacant storefronts downtown',
      summary:
        'Business owners and residents are discussing several recent ' +
        'downtown closures and what would bring foot traffic back.',
    },
  ].map((issue) => ({
    ...issue,
    organizationSlug: JUDGE_FIXTURE.orgSlug,
    archivedAt: null,
  })),
})

// WHERE THE SEED IS ABOUT TO WRITE. The cluster identifiers come from
// deploy/index.ts (`gp-api-db` for dev, `gp-api-db-prod` for prod), and an RDS
// endpoint's first DNS label is its cluster identifier. Anything that names
// prod is refused outright; only the dev cluster passes without a typed
// confirmation, because a localhost URL can be a tunnel to anything.
export type DatabaseTargetKind = 'dev' | 'prod' | 'unknown'

export interface DatabaseTarget {
  host: string
  port: string
  database: string
  kind: DatabaseTargetKind
}

const DEV_CLUSTER = 'gp-api-db'
const RDS_SUFFIX = '.rds.amazonaws.com'

export const databaseTarget = (url: string): DatabaseTarget => {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  const cluster = host.split('.')[0] ?? ''
  const kind: DatabaseTargetKind = host.includes('prod')
    ? 'prod'
    : cluster === DEV_CLUSTER && host.endsWith(RDS_SUFFIX)
      ? 'dev'
      : 'unknown'
  return {
    host,
    port: parsed.port,
    database: parsed.pathname.replace(/^\//, ''),
    kind,
  }
}

// Why the seed must not run, or undefined when it may. `typedHost` is what the
// operator typed back for a host this file cannot place.
export const seedRefusal = (
  target: DatabaseTarget,
  typedHost?: string,
): string | undefined => {
  if (target.kind === 'prod') {
    return `${target.host} is a production database; the judge fixture is dev only`
  }
  if (target.kind === 'dev') return undefined
  return typedHost?.trim().toLowerCase() === target.host
    ? undefined
    : `${target.host} is not the dev cluster, and the host typed back did not match it`
}

type Scalar = string | number | boolean | Date | null

const sameValue = (a?: Scalar, b?: Scalar): boolean =>
  a instanceof Date && b instanceof Date ? isEqual(a, b) : a === b

// Compares only the fields the plan owns, so a row someone else touched in a
// column the plan does not set still reads as unchanged.
const differs = <T extends Record<string, Scalar>>(
  desired: T,
  existing: Record<keyof T, Scalar>,
): boolean => {
  for (const key in desired) {
    if (!sameValue(desired[key], existing[key])) return true
  }
  return false
}

export interface SeedReport {
  created: string[]
  updated: string[]
  unchanged: string[]
}

const refuse = (message: string): never => {
  throw new Error(`refusing to seed the judge fixture: ${message}`)
}

// Idempotent: a row is created when missing, rewritten only when a field the
// plan owns differs, and otherwise left alone, so a second run writes nothing
// and does not even move updatedAt. One transaction, so a failure part way
// leaves the database as it was.
export const seedJudgeFixture = (
  prisma: PrismaClient,
  plan: JudgeFixturePlan = judgeFixturePlan(),
): Promise<SeedReport> =>
  prisma.$transaction(async (tx) => {
    const report: SeedReport = { created: [], updated: [], unchanged: [] }
    const record = (outcome: keyof SeedReport, label: string): void => {
      report[outcome].push(label)
    }

    const existingUser = await tx.user.findUnique({
      where: { clerkId: plan.user.clerkId },
    })
    if (existingUser === null) {
      const sameEmail = await tx.user.findUnique({
        where: { email: plan.user.email },
      })
      if (sameEmail !== null) {
        refuse(
          `user ${sameEmail.id} already has ${plan.user.email} under another ` +
            'clerk id',
        )
      }
    }
    const user =
      existingUser === null
        ? await tx.user.create({ data: plan.user })
        : differs(plan.user, existingUser)
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: plan.user,
            })
          : existingUser
    record(
      existingUser === null
        ? 'created'
        : user === existingUser
          ? 'unchanged'
          : 'updated',
      `user ${plan.user.clerkId}`,
    )

    const existingOrg = await tx.organization.findUnique({
      where: { slug: plan.organization.slug },
    })
    if (existingOrg !== null && existingOrg.ownerId !== user.id) {
      refuse(
        `organization ${plan.organization.slug} is owned by user ` +
          `${existingOrg.ownerId}`,
      )
    }
    const campaigns = await tx.campaign.count({
      where: { organizationSlug: plan.organization.slug },
    })
    if (campaigns > 0) {
      refuse(
        `organization ${plan.organization.slug} has a campaign, which would ` +
          'give a judge run write tools',
      )
    }
    if (existingOrg === null) {
      await tx.organization.create({
        data: { ...plan.organization, ownerId: user.id },
      })
      record('created', `organization ${plan.organization.slug}`)
    } else if (differs(plan.organization, existingOrg)) {
      await tx.organization.update({
        where: { slug: existingOrg.slug },
        data: plan.organization,
      })
      record('updated', `organization ${plan.organization.slug}`)
    } else {
      record('unchanged', `organization ${plan.organization.slug}`)
    }

    const existingOffice = await tx.electedOffice.findUnique({
      where: { organizationSlug: plan.electedOffice.organizationSlug },
    })
    if (existingOffice !== null && existingOffice.userId !== user.id) {
      refuse(
        `the elected office on ${plan.electedOffice.organizationSlug} ` +
          `belongs to user ${existingOffice.userId}`,
      )
    }
    const office =
      existingOffice === null
        ? await tx.electedOffice.create({
            data: { ...plan.electedOffice, userId: user.id },
          })
        : differs(plan.electedOffice, existingOffice)
          ? await tx.electedOffice.update({
              where: { id: existingOffice.id },
              data: plan.electedOffice,
            })
          : existingOffice
    record(
      existingOffice === null
        ? 'created'
        : office === existingOffice
          ? 'unchanged'
          : 'updated',
      `elected office on ${plan.electedOffice.organizationSlug}`,
    )

    for (const priority of plan.priorities) {
      const existing = await tx.priority.findUnique({
        where: { id: priority.id },
      })
      if (existing !== null && existing.electedOfficeId !== office.id) {
        refuse(`priority ${priority.id} belongs to another elected office`)
      }
      if (existing === null) {
        await tx.priority.create({
          data: { ...priority, electedOfficeId: office.id },
        })
        record('created', `priority ${priority.id}`)
      } else if (differs(priority, existing)) {
        await tx.priority.update({ where: { id: priority.id }, data: priority })
        record('updated', `priority ${priority.id}`)
      } else {
        record('unchanged', `priority ${priority.id}`)
      }
    }

    for (const issue of plan.communityIssues) {
      const existing = await tx.communityIssue.findUnique({
        where: { id: issue.id },
      })
      if (
        existing !== null &&
        existing.organizationSlug !== issue.organizationSlug
      ) {
        refuse(`community issue ${issue.id} belongs to another organization`)
      }
      if (existing === null) {
        await tx.communityIssue.create({ data: issue })
        record('created', `community issue ${issue.id}`)
      } else if (differs(issue, existing)) {
        await tx.communityIssue.update({ where: { id: issue.id }, data: issue })
        record('updated', `community issue ${issue.id}`)
      } else {
        record('unchanged', `community issue ${issue.id}`)
      }
    }

    return report
  })
