import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXPECTED_PROD_RECEIVERS,
  misroutedAlerts,
  PolicyTree,
  receiverFor,
  samePolicyTree,
} from './alert-routing'
import { provisionedAlertSlugs } from './provisioned-alerts'

const POLICY: PolicyTree = JSON.parse(
  readFileSync(join(__dirname, 'alert-routing.policy.json'), 'utf8'),
  // The snapshot is a Grafana API response with a known shape; the tests below
  // are what check it still says what this file assumes.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
) as PolicyTree

const allSlugs = provisionedAlertSlugs

describe('routing every provisioned alert', () => {
  it('delivers all of them to an expected receiver in prod', () => {
    const misrouted = misroutedAlerts({
      tree: POLICY,
      slugs: allSlugs(),
      environment: 'prod',
      expected: EXPECTED_PROD_RECEIVERS,
    })

    expect(
      misrouted,
      `these alerts would be delivered somewhere unexpected: ${JSON.stringify(misrouted)}`,
    ).toEqual([])
  })

  // Why the deploy-time check in grafana.ts runs only for prod. Non-prod going
  // to 'nowhere' is correct, but 'nowhere' is not an expected prod receiver, so
  // checking a dev deploy against that list flags every slug at once. A
  // warning that always fires is one nobody reads, which is the failure the
  // guard exists to catch.
  it('flags every slug in dev, which is why the deploy check is prod-only', () => {
    const misrouted = misroutedAlerts({
      tree: POLICY,
      slugs: allSlugs(),
      environment: 'dev',
      expected: EXPECTED_PROD_RECEIVERS,
    })

    expect(misrouted).toHaveLength(allSlugs().length)
    expect(new Set(misrouted.map((m) => m.receiver))).toEqual(
      new Set(['nowhere']),
    )
  })

  it('sends non-prod nowhere, which is what keeps dev out of Slack', () => {
    expect(
      receiverFor(POLICY, { alert_slug: 'gp-api-5xx', environment: 'dev' }),
    ).toBe('nowhere')
    expect(
      receiverFor(POLICY, { alert_slug: 'gp-api-5xx', environment: 'preview' }),
    ).toBe('nowhere')
  })

  // An alert that somehow carries no environment label must not reach Slack by
  // default. This is the `!=` matcher's job and the reason a missing label is
  // modelled as an empty string.
  it('treats an alert with no environment label as non-prod', () => {
    expect(receiverFor(POLICY, { alert_slug: 'gp-api-5xx' })).toBe('nowhere')
  })
})

/**
 * The regression. This is the route that was live in Grafana Cloud until
 * 2026-09-17, reproduced exactly as the provisioning API returned it.
 */
const TREE_WITH_STALE_WARNING_ROUTE: PolicyTree = {
  receiver: 'dev-alerts',
  group_by: ['alert_slug'],
  routes: [
    { receiver: 'nowhere', object_matchers: [['environment', '!=', 'prod']] },
    {
      receiver: 'dev-warnings',
      object_matchers: [['alert_slug', '=~', '.*warning.*']],
    },
  ],
} as PolicyTree

describe('the stale dev-warnings route', () => {
  // `dev-warnings` was a test channel with zero messages in it. These two
  // alerts fired in prod six times in seven days and notified nobody.
  it('would have been caught, naming both silenced alerts', () => {
    const misrouted = misroutedAlerts({
      tree: TREE_WITH_STALE_WARNING_ROUTE,
      slugs: allSlugs(),
      environment: 'prod',
      expected: EXPECTED_PROD_RECEIVERS,
    })

    expect(misrouted.map((m) => m.slug).sort()).toEqual([
      'win-outreach-paid-not-scheduled-warning',
      'win-peerly-warnings',
    ])
    expect(new Set(misrouted.map((m) => m.receiver))).toEqual(
      new Set(['dev-warnings']),
    )
  })

  // The narrower failure is the one that makes this worth a guard rather than a
  // one-off fix: the route was harmless when written and became harmful when
  // somebody chose a name. A future slug with "warning" in it is the same bug.
  it('diverts any slug containing the word, not just the two that existed', () => {
    expect(
      receiverFor(TREE_WITH_STALE_WARNING_ROUTE, {
        alert_slug: 'some-future-warning-alert',
        environment: 'prod',
      }),
    ).toBe('dev-warnings')
  })
})

describe('comparing the live tree to the snapshot', () => {
  it('ignores key order, which JSON does not give meaning to', () => {
    expect(
      samePolicyTree(
        { receiver: 'dev-alerts', group_by: ['alert_slug'] },
        { group_by: ['alert_slug'], receiver: 'dev-alerts' },
      ),
    ).toBe(true)
  })

  it('ignores key order inside a nested route too', () => {
    expect(
      samePolicyTree(
        {
          receiver: 'dev-alerts',
          routes: [
            {
              receiver: 'nowhere',
              object_matchers: [['environment', '!=', 'prod']],
            },
          ],
        },
        {
          routes: [
            {
              object_matchers: [['environment', '!=', 'prod']],
              receiver: 'nowhere',
            },
          ],
          receiver: 'dev-alerts',
        },
      ),
    ).toBe(true)
  })

  // The half that must survive normalising: route order decides which match
  // wins, so a reordered `routes` array is a real change and sorting it would
  // quietly turn this whole check into a no-op.
  it('still reports drift when routes are reordered', () => {
    const a: PolicyTree = {
      receiver: 'dev-alerts',
      routes: [
        { receiver: 'nowhere', object_matchers: [['k', '=', 'v']] },
        { receiver: 'dev-warnings', object_matchers: [['k', '=', 'v']] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(samePolicyTree(a, { ...a, routes: [...a.routes!].reverse() })).toBe(
      false,
    )
  })

  it('still reports drift when a receiver changes', () => {
    expect(
      samePolicyTree({ receiver: 'dev-alerts' }, { receiver: 'dev-warnings' }),
    ).toBe(false)
  })

  it('still reports drift when a route is added', () => {
    expect(samePolicyTree({ receiver: 'dev-alerts' }, POLICY)).toBe(false)
  })

  it('matches the committed snapshot against a re-parse of itself', () => {
    expect(samePolicyTree(POLICY, JSON.parse(JSON.stringify(POLICY)))).toBe(
      true,
    )
  })
})

describe('matcher semantics', () => {
  const tree = (matcher: [string, string, string]): PolicyTree =>
    ({
      receiver: 'default',
      routes: [{ receiver: 'diverted', object_matchers: [matcher] }],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    }) as PolicyTree

  it.each([
    ['=', 'a', 'a', 'diverted'],
    ['=', 'a', 'b', 'default'],
    ['!=', 'a', 'b', 'diverted'],
    ['!=', 'a', 'a', 'default'],
    ['=~', 'a.*', 'abc', 'diverted'],
    ['=~', 'a.*', 'xbc', 'default'],
    ['!~', 'a.*', 'xbc', 'diverted'],
    ['!~', 'a.*', 'abc', 'default'],
  ])('%s %s against %s routes to %s', (op, value, actual, expected) => {
    expect(receiverFor(tree(['k', op, value]), { k: actual })).toBe(expected)
  })

  // Anchored, because Grafana anchors matcher regexes. Unanchored `=~ "prod"`
  // would match "preview-prod-clone" and quietly widen every route it appears
  // in.
  it('anchors regex matchers', () => {
    expect(
      receiverFor(tree(['k', '=~', 'prod']), { k: 'not-prod-really' }),
    ).toBe('default')
  })

  it('stops at the first matching sibling', () => {
    const first: PolicyTree = {
      receiver: 'default',
      routes: [
        { receiver: 'first', object_matchers: [['k', '=', 'v']] },
        { receiver: 'second', object_matchers: [['k', '=', 'v']] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(receiverFor(first, { k: 'v' })).toBe('first')
  })

  it('keeps looking when a matching route says continue', () => {
    const continues: PolicyTree = {
      receiver: 'default',
      routes: [
        {
          receiver: 'first',
          object_matchers: [['k', '=', 'v']],
          continue: true,
        },
        { receiver: 'second', object_matchers: [['k', '=', 'v']] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(receiverFor(continues, { k: 'v' })).toBe('second')
  })

  // The other half of `continue`, and the one that can mask a misrouting: when
  // nothing after it matches, the continued route is itself the delivery point.
  // Alertmanager only falls back to the parent when no child matched at all.
  it('still delivers to a continue route when no sibling follows', () => {
    const lone: PolicyTree = {
      receiver: 'default',
      routes: [
        {
          receiver: 'first',
          object_matchers: [['k', '=', 'v']],
          continue: true,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(receiverFor(lone, { k: 'v' })).toBe('first')
    // Nothing matched below, so the parent is still the answer here.
    expect(receiverFor(lone, { k: 'other' })).toBe('default')
  })

  it('lets a nested route override its parent', () => {
    const nested: PolicyTree = {
      receiver: 'default',
      routes: [
        {
          receiver: 'parent',
          object_matchers: [['a', '=', '1']],
          routes: [{ receiver: 'child', object_matchers: [['b', '=', '2']] }],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(receiverFor(nested, { a: '1', b: '2' })).toBe('child')
    expect(receiverFor(nested, { a: '1', b: '3' })).toBe('parent')
  })

  // An operator this module does not model must not be able to manufacture a
  // pass by being treated as "matches nothing dangerous".
  it('does not silently honour an operator it cannot evaluate', () => {
    expect(receiverFor(tree(['k', '???', 'v']), { k: 'v' })).toBe('default')
  })

  // The tree is hand-edited, so an uncompilable pattern is a realistic thing to
  // read back from Grafana. This runs inside a Pulumi deploy, outside the
  // try/catch that guards the fetch, so a SyntaxError here would abort the
  // deploy instead of warning.
  it.each(['=~', '!~'])(
    'treats a regex it cannot compile as no match rather than throwing (%s)',
    (op) => {
      expect(() =>
        receiverFor(tree(['k', op, '[']), { k: 'anything' }),
      ).not.toThrow()
      expect(receiverFor(tree(['k', op, '[']), { k: 'anything' })).toBe(
        'default',
      )
    },
  )

  // A whole-tree version of the above: the deploy path calls misroutedAlerts,
  // and it must come back with an answer, not an exception.
  it('still reports a verdict when the live tree holds a broken pattern', () => {
    const broken: PolicyTree = {
      receiver: 'dev-alerts',
      routes: [
        { receiver: 'nowhere', object_matchers: [['alert_slug', '=~', '(']] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } as PolicyTree

    expect(
      misroutedAlerts({
        tree: broken,
        slugs: allSlugs(),
        environment: 'prod',
        expected: EXPECTED_PROD_RECEIVERS,
      }),
    ).toEqual([])
  })
})
