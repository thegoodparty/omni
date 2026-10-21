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
  const url = (host: string) => `postgresql://gpuser:s3cret@${host}:5432/gpdb`
  const DEV_HOST = 'gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com'

  it('reads the dev writer endpoint as dev, and never carries the password', () => {
    const target = databaseTarget(url(DEV_HOST))
    expect(target).toEqual({
      host: DEV_HOST,
      port: '5432',
      database: 'gpdb',
      kind: 'dev',
    })
    expect(JSON.stringify(target)).not.toContain('s3cret')
  })

  it.each([
    'gp-api-db-prod.cluster-abc123.us-west-2.rds.amazonaws.com',
    'gp-api-db-production-1.cluster-x.us-west-2.rds.amazonaws.com',
    'db.prod.example',
  ])('reads %s as prod', (host) => {
    expect(databaseTarget(url(host)).kind).toBe('prod')
  })

  // A tunnel or an IP can point anywhere, the reader is not where writes go,
  // and a preview or staging cluster is not the database the dev gp-api reads.
  it.each([
    'localhost',
    '127.0.0.1',
    'gp-api-db.cluster-ro-abc123.us-west-2.rds.amazonaws.com',
    'gp-api-db-staging.cluster-x.us-west-2.rds.amazonaws.com',
    'gp-api-preview-shared-db.cluster-x.us-west-2.rds.amazonaws.com',
    'gp-api-db.amazonaws.com.evil.example',
    'evil-gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com',
    'gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com.evil.example',
    'gp-api-db.example.com',
    'gp-api-db.cluster-abc123..rds.amazonaws.com',
  ])('cannot place %s', (host) => {
    expect(databaseTarget(url(host)).kind).toBe('unknown')
  })

  // Prisma connects to these over the URL's host, so a dev hostname is no
  // evidence of where the writes go once one is present.
  const DEV =
    'postgresql://u:p@gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com:5432/gpdb'
  it.each([
    '?host=localhost',
    '?hostaddr=127.0.0.1',
    '?schema=public&host=localhost',
  ])('cannot place a dev hostname redirected by %s', (query) => {
    expect(databaseTarget(`${DEV}${query}`).kind).toBe('unknown')
  })

  it('places a dev URL with the parameters the README uses', () => {
    expect(databaseTarget(`${DEV}?schema=public&sslmode=require`).kind).toBe(
      'dev',
    )
  })
})

describe('seedRefusal', () => {
  const target = (kind: 'dev' | 'prod' | 'unknown') => ({
    host: 'some-host',
    port: '5432',
    database: 'gpdb',
    kind,
  })

  it('lets only the dev cluster through', () => {
    expect(seedRefusal(target('dev'))).toBeUndefined()
  })

  it('refuses prod', () => {
    expect(seedRefusal(target('prod'))).toMatch(/production/)
  })

  it('refuses a host it cannot place, with no way to confirm it', () => {
    expect(seedRefusal(target('unknown'))).toMatch(/not the dev cluster/)
  })
})
