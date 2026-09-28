import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALERT_FILTER_WEBHOOK_URLS } from './grafana'

/**
 * The Terraform that publishes the endpoint Pulumi points Grafana at.
 *
 * Read from disk rather than imported, because it is HCL in another package's
 * infrastructure root and there is no other way for a test in gp-api to see it.
 */
const SHARED_INFRA = join(
  __dirname,
  '../../../gp-ai/infrastructure/environments/prod/shared-infra/main.tf',
)

describe('the alert filter webhook address', () => {
  // The URL used to come from ALERT_FILTER_WEBHOOK_URL in the deploy
  // environment, which nothing set, so the contact point was never created and
  // the whole feature sat dark. Making it a constant fixes that but buys a new
  // way to be wrong: a constant in Pulumi and a path in Terraform that quietly
  // disagree, which fails as a 404 on the first alert Grafana tries to deliver
  // and nowhere earlier.
  it('matches the path the ALB actually routes', () => {
    const terraform = readFileSync(SHARED_INFRA, 'utf8')

    const rule = terraform.slice(
      terraform.indexOf('resource "aws_lb_listener_rule" "alert_filter"'),
    )
    const pathPattern = /path_pattern\s*{\s*values\s*=\s*\["([^"]+)"\]/.exec(
      rule,
    )

    expect(
      pathPattern,
      'no path_pattern found on the alert_filter listener rule',
    ).not.toBeNull()

    const { pathname } = new URL(ALERT_FILTER_WEBHOOK_URLS.prod)
    expect(pathname).toBe(pathPattern?.[1])
  })

  // Not just "is a URL": an http address here would send the shared secret and
  // every alert body over the open internet in cleartext, and the secret is
  // what stops anyone posting arbitrary text into an engineering channel.
  it('is https on the host the ALB serves', () => {
    const { protocol, hostname } = new URL(ALERT_FILTER_WEBHOOK_URLS.prod)

    expect(protocol).toBe('https:')
    expect(hostname).toBe('ai.goodparty.org')
  })

  // One Lambda serves both environments' alerts, so a dev entry would point at
  // a host that does not answer. The deploy is written to skip loudly on a
  // missing entry; this asserts that dev really is missing rather than someone
  // having added a plausible-looking dev URL later.
  it('claims an endpoint only for prod', () => {
    expect(Object.keys(ALERT_FILTER_WEBHOOK_URLS)).toEqual(['prod'])
  })
})

describe('the recording rule window', () => {
  /**
   * Grafana parses the expression blob into a struct whose `relative_time_range`
   * fields are seconds-as-int. A duration string lands as 0, which collapses
   * the window onto `now` — and because the window no longer overlaps the way
   * the old ten-minute one did, every log line that arrived late is dropped
   * permanently rather than caught on the next pass. It fails silently: the
   * rule saves, records, and is simply short.
   *
   * Asserted against the source because the blob is built inside the component
   * and there is nothing to import.
   */
  it('passes seconds as integers, not duration strings', () => {
    const source = readFileSync(join(__dirname, 'grafana.ts'), 'utf8')

    const block = /relative_time_range:\s*\{([^}]*)\}/.exec(source)

    expect(block, 'no relative_time_range found in grafana.ts').not.toBeNull()

    // Any quote, not just a backtick. The bug shipped as `${n}s`, but '120s'
    // and "120s" fail Grafana identically, and a guard that bans one spelling
    // of a mistake is not a guard against the mistake.
    expect(block?.[1]).not.toMatch(/['"`]/)

    // And the values are what they claim to be: a bare identifier or number
    // on each side, so a future `String(n)` or `n + 's'` cannot slip past a
    // quote check that has nothing to match on.
    expect(block?.[1]).toMatch(
      /^\s*from:\s*[A-Za-z0-9_.]+,\s*to:\s*[A-Za-z0-9_.]+,?\s*$/,
    )
  })
})
