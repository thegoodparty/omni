import { createHash } from 'node:crypto'

/**
 * A stable Grafana uid for one provisioned alert rule.
 *
 * WHY THIS EXISTS. `alertToRule` used to set no uid, so Grafana minted one for
 * every rule in a group on every apply and those uids moved between alerts
 * whenever the group's membership changed. A notification carries its rule's
 * uid in the *View in Grafana* and *Silence* links and in nothing else, so the
 * link on a page stops pointing at the rule that fired the moment anyone adds
 * or removes an alert.
 *
 * Measured against the 2026-09-28 17:01-18:25Z query-path outage, where 190 of
 * 216 rules fired: of the four pages from that hour that reached an incident,
 * two links no longer resolve to the rule that sent them. `ffyfzdfereakga` had
 * been "[People] Public campaign lookup failing" and today opens "Alert
 * notifications are failing to deliver"; `dfynonhv8ucqoa` had been "[People]
 * Person id repoint blocked" and today 404s. Both moved in the 2026-09-29
 * 06:35Z deploy, ~12 hours after the pages were sent and while they were still
 * being investigated. The reader is not told the link is stale — it opens a
 * different rule, with a different query and a different meaning.
 *
 * The same churn breaks per-rule state history, which is keyed on the uid: the
 * firing history of one alert is split across however many uids it has held,
 * and the only way to reassemble it is to know that a uid changed hands.
 *
 * Recording rules have pinned their uid to `gp-api-<env>-<slug>` since they
 * landed, for the related reason in grafana.ts. This is the alert-rule half.
 */

/**
 * Grafana rejects a uid longer than this (`util.MaxUIDLength`) or holding
 * anything outside `[a-zA-Z0-9-_]`, and a rule group that fails validation
 * fails the whole deploy. Controller slugs carry the controller path verbatim
 * (`campaigns/tcr-compliance-route-errors`), so both limits are live.
 */
const MAX_UID_LENGTH = 40
const DIGEST_LENGTH = 8

const sanitise = (value: string) => value.replace(/[^a-zA-Z0-9-_]/g, '-')

/**
 * Readable where it fits, hashed only where it does not.
 *
 * The prefix is environment-scoped because dev and prod provision the same
 * definitions into the same Grafana org, and a shared uid would make each
 * deploy repoint the other environment's rule at its own logs.
 *
 * A slug too long to carry whole is truncated and given a digest of the full
 * sanitised uid, which keeps the result unique — two controllers whose names
 * agree for the first 31 characters would otherwise collide and silently
 * provision one rule instead of two.
 */
export const alertRuleUid = ({
  slug,
  environment,
}: {
  slug: string
  environment: string
}): string => {
  const uid = sanitise(`gp-api-${environment}-${slug}`)
  if (uid.length <= MAX_UID_LENGTH) return uid

  const digest = createHash('sha256').update(uid).digest('hex')
  return `${uid.slice(0, MAX_UID_LENGTH - DIGEST_LENGTH - 1)}-${digest.slice(
    0,
    DIGEST_LENGTH,
  )}`
}
