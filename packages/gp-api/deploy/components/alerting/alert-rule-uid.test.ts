import { describe, expect, it } from 'vitest'
import { alertRuleUid } from './alert-rule-uid'
import { provisionedAlertSlugs } from './provisioned-alerts'

const ENVIRONMENTS = ['dev', 'prod'] as const

/**
 * Grafana's own constraints. A rule group whose uid violates either is rejected
 * at apply time, which fails the deploy for every rule in the group rather than
 * the one that is too long.
 */
const MAX_UID_LENGTH = 40
const UID_PATTERN = /^[a-zA-Z0-9-_]+$/

describe('alertRuleUid', () => {
  it('is the same uid for the same alert every time', () => {
    const first = alertRuleUid({ slug: 'high-memory', environment: 'prod' })
    const second = alertRuleUid({ slug: 'high-memory', environment: 'prod' })

    expect(first).toBe(second)
    expect(first).toBe('gp-api-prod-high-memory')
  })

  // Both environments provision the same definitions into the same Grafana
  // org, so an environment-blind uid would make each deploy repoint the other's
  // rule at its own logs.
  it('separates the environments', () => {
    expect(alertRuleUid({ slug: 'high-memory', environment: 'dev' })).not.toBe(
      alertRuleUid({ slug: 'high-memory', environment: 'prod' }),
    )
  })

  // Controller slugs carry the controller path verbatim, and a slash in a uid
  // is rejected.
  it('replaces characters Grafana will not accept', () => {
    expect(
      alertRuleUid({
        slug: 'campaigns/tracker-tasks-route-errors',
        environment: 'dev',
      }),
    ).toMatch(UID_PATTERN)
  })

  it('keeps a long slug unique rather than truncating it into a collision', () => {
    const shared = 'a'.repeat(60)
    const one = alertRuleUid({ slug: `${shared}-one`, environment: 'prod' })
    const two = alertRuleUid({ slug: `${shared}-two`, environment: 'prod' })

    expect(one.length).toBe(MAX_UID_LENGTH)
    expect(one).not.toBe(two)
  })

  // The guard that matters: every rule this repo actually provisions has to get
  // a uid Grafana will store, and no two rules may share one.
  it('gives every provisioned rule a valid, distinct uid', () => {
    const slugs = provisionedAlertSlugs()
    expect(slugs.length).toBeGreaterThan(0)

    const uids = ENVIRONMENTS.flatMap((environment) =>
      slugs.map((slug) => alertRuleUid({ slug, environment })),
    )

    for (const uid of uids) {
      expect(uid).toMatch(UID_PATTERN)
      expect(uid.length).toBeLessThanOrEqual(MAX_UID_LENGTH)
    }

    expect(new Set(uids).size).toBe(uids.length)
  })
})
