import { describe, expect, it } from 'vitest'
import { CommunityIssueListQueryDto } from '@/communityIssues/schemas/communityIssues.schema'
import { JUDGE_FIXTURE } from './judgeFixtureIdentity'
import {
  databaseTarget,
  judgeFixturePlan,
  seedRefusal,
} from './judgeFixtureSeed'

describe('judgeFixturePlan', () => {
  const plan = judgeFixturePlan()

  it('is the fixture identity, owning its own organization', () => {
    expect(plan.user).toMatchObject({
      clerkId: JUDGE_FIXTURE.clerkUserId,
      email: JUDGE_FIXTURE.email,
    })
    expect(plan.organization.slug).toBe(JUDGE_FIXTURE.orgSlug)
    expect(plan.electedOffice.organizationSlug).toBe(JUDGE_FIXTURE.orgSlug)
  })

  // The office having no campaign is what makes the website, domain and
  // Peerly tools 404 for a judge run.
  it('gives the office no campaign', () => {
    expect(plan.electedOffice.campaignId).toBeNull()
  })

  it('carries a handful of active priorities with unique ids', () => {
    expect(plan.priorities.length).toBeGreaterThanOrEqual(3)
    expect(new Set(plan.priorities.map((p) => p.id)).size).toBe(
      plan.priorities.length,
    )
    for (const priority of plan.priorities) {
      expect(priority.archivedAt).toBeNull()
    }
  })

  // Read off the route's own query schema, so a list value added there is a
  // failing test here rather than an empty feed under a judge run.
  it('fills every list the community-issues route accepts', () => {
    const accepted = CommunityIssueListQueryDto.schema.shape.list.options
    expect(accepted.length).toBeGreaterThan(0)
    for (const list of accepted) {
      const issues = plan.communityIssues.filter((i) => i.list === list)
      expect(issues.length, list).toBeGreaterThan(0)
      expect(issues.map((i) => i.rank).sort(), list).toEqual(
        issues.map((_, index) => index + 1),
      )
    }
  })

  it('puts every issue on the fixture organization, active, with unique ids', () => {
    expect(new Set(plan.communityIssues.map((i) => i.id)).size).toBe(
      plan.communityIssues.length,
    )
    for (const issue of plan.communityIssues) {
      expect(issue.organizationSlug).toBe(JUDGE_FIXTURE.orgSlug)
      expect(issue.archivedAt).toBeNull()
    }
  })

  it('is the same plan every time', () => {
    expect(judgeFixturePlan()).toEqual(plan)
  })
})

describe('databaseTarget', () => {
  const DEV =
    'postgresql://gpuser:s3cret@gp-api-db.cluster-abc123.us-west-2.rds.' +
    'amazonaws.com:5432/gpdb'
  const PROD =
    'postgresql://gpuser:s3cret@gp-api-db-prod.cluster-abc123.us-west-2.rds.' +
    'amazonaws.com:5432/gpdb'

  it('reads the dev cluster as dev, and never carries the password', () => {
    const target = databaseTarget(DEV)
    expect(target).toEqual({
      host: 'gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com',
      port: '5432',
      database: 'gpdb',
      kind: 'dev',
    })
    expect(JSON.stringify(target)).not.toContain('s3cret')
  })

  it('reads the prod cluster as prod', () => {
    expect(databaseTarget(PROD).kind).toBe('prod')
  })

  it('reads any host naming prod as prod', () => {
    expect(databaseTarget('postgresql://u:p@db.prod.example:5432/x').kind).toBe(
      'prod',
    )
  })

  // A localhost URL can be a tunnel to any cluster, and the reader endpoint
  // or a preview cluster is not the database the dev gp-api reads.
  it.each([
    'postgresql://postgres:postgres@localhost:5432/gpdb',
    'postgresql://u:p@gp-api-preview-shared-db.cluster-x.us-west-2.rds.amazonaws.com/gpdb_pr_1',
    'postgresql://u:p@gp-api-db.example.com/gpdb',
  ])('cannot place %s', (url) => {
    expect(databaseTarget(url).kind).toBe('unknown')
  })
})

describe('seedRefusal', () => {
  const target = (kind: 'dev' | 'prod' | 'unknown') => ({
    host: 'localhost',
    port: '5432',
    database: 'gpdb',
    kind,
  })

  it('lets the dev cluster through without asking', () => {
    expect(seedRefusal(target('dev'))).toBeUndefined()
  })

  it('refuses prod, whatever is typed', () => {
    expect(seedRefusal(target('prod'), 'localhost')).toMatch(/production/)
  })

  it('lets an unknown host through only when it is typed back', () => {
    expect(seedRefusal(target('unknown'), ' localhost ')).toBeUndefined()
    expect(seedRefusal(target('unknown'), 'other-host')).toMatch(
      /did not match/,
    )
    expect(seedRefusal(target('unknown'))).toMatch(/did not match/)
  })
})
