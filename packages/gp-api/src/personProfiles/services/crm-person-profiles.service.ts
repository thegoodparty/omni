import { Inject, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { HubspotService } from '@/crm/hubspot.service'
import { CRMContactProperties } from '@/crm/crm.types'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { ProfileClaimRequestSource } from '../../generated/prisma'
import { PERSON_PROFILES_DATABRICKS } from '../personProfiles.constants'
import { recordClaimRequestCrmSync } from '../observability/person-profiles.metrics'

// Person-grain HubSpot linkage. `mart_civics.people` is the canonical person
// mart — one row per `gp_person_id`, which IS the `personId` this endpoint
// receives (election-api's `Person.id` is the same value). `hs_contact_id` is
// scalar only where the identity cluster carries exactly one HubSpot contact,
// and null otherwise, so an ambiguous person resolves to nothing rather than to
// an arbitrary contact.
const CIVICS_PEOPLE_TABLE = 'goodparty_data_catalog.mart_civics.people'

// Defence in depth before the id reaches SQL. The DTO already validates
// `personId` as a UUID (`z.guid`), but this builder interpolates rather than
// binds — the Databricks driver has no parameter binding here — so it re-checks
// the shape itself instead of trusting a caller two layers up.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Keeps the candidate's HubSpot contact property `candidate_profile_requests`
 * in step with how many visitors have asked that person to complete their
 * public profile.
 *
 * WHY A COMPUTED COUNT AND NOT AN INCREMENT: HubSpot has no atomic increment, so
 * "+1" means read-then-write, which loses counts under concurrent submissions,
 * double-counts on a retried timeout, and can never recover once it has drifted.
 * We already persist every claim request, so the request count in our own
 * Postgres IS the number — writing it wholesale is race-free, idempotent, and
 * self-healing: any submission after a failed write restores the true value.
 *
 * Every submission counts, including repeats from the same email address. That
 * is the intended behaviour (a nudge is a nudge), and the endpoint's per-IP
 * token bucket — see ProfileClaimRequestRateLimitGuard — is what bounds refresh
 * and script inflation. Deduping by email would need a deliberate product call,
 * because it would also silently discard genuine repeat interest.
 *
 * Best-effort throughout: this runs after the lead row is committed and NEVER
 * throws, so a HubSpot or warehouse outage can never fail a visitor's
 * submission or surface an error on the public page.
 */
@Injectable()
export class CrmPersonProfilesService extends createPrismaBase(
  MODELS.ProfileClaimRequest,
) {
  constructor(
    private readonly hubspot: HubspotService,
    @Inject(PERSON_PROFILES_DATABRICKS)
    private readonly databricks: DatabricksProvider | null,
  ) {
    super()
  }

  async syncClaimRequestCount(personId: string): Promise<void> {
    // Off-prod the HubSpot client is a no-op mock whose update() resolves
    // undefined; treating that as a real write would report success for
    // something that never happened.
    if (!this.hubspot.isConfigured) {
      this.logger.debug(
        { personId },
        'HubSpot not configured; skipping candidate_profile_requests sync',
      )
      recordClaimRequestCrmSync('skipped')
      return
    }

    try {
      const contactId = await this.resolveHubspotContactId(personId)
      if (!contactId) {
        // Expected for anyone the CRM has never heard of, which is most of the
        // civics spine. Nothing is created here on purpose: a visitor nudging
        // someone should not mint a CRM contact for a person who never opted
        // into anything.
        this.logger.info(
          { personId },
          'No HubSpot contact for person; skipping candidate_profile_requests sync',
        )
        recordClaimRequestCrmSync('no_contact')
        return
      }

      const requestCount = await this.model.count({
        where: { personId, source: ProfileClaimRequestSource.notify },
      })

      const properties: Partial<CRMContactProperties> = {
        candidate_profile_requests: String(requestCount),
      }
      await this.hubspot.client.crm.contacts.basicApi.update(contactId, {
        properties,
      })

      this.logger.debug(
        { personId, contactId, requestCount },
        'Synced candidate_profile_requests to HubSpot',
      )
      recordClaimRequestCrmSync('success')
    } catch (error) {
      this.logger.error(
        { error, personId },
        'candidate_profile_requests sync failed (non-fatal)',
      )
      recordClaimRequestCrmSync('failed')
    }
  }

  /**
   * personId → HubSpot contact id, via the civics person mart.
   *
   * There is no closer source: gp-api holds a HubSpot contact id only for its
   * own users (`User.metaData.hubspotId`), and the people these forms appear on
   * are by definition unclaimed, so they have no user. election-api holds the
   * person spine but deliberately refuses to serve `Person.email` on its public
   * endpoints (see PERSON_PII_COLUMNS), so there is no key to search HubSpot by
   * either. The warehouse is where the person↔contact resolution already lives.
   *
   * Returns null — never throws — when the warehouse is unconfigured, so the
   * feature is simply inert rather than broken in an environment without it.
   */
  private async resolveHubspotContactId(
    personId: string,
  ): Promise<string | null> {
    if (!this.databricks) return null
    if (!UUID_PATTERN.test(personId)) return null

    const { rows } = await this.databricks.query(
      `SELECT hs_contact_id FROM ${CIVICS_PEOPLE_TABLE} ` +
        `WHERE gp_person_id = '${personId}' LIMIT 1`,
    )

    const contactId = rows[0]?.hs_contact_id
    if (contactId === null || contactId === undefined) return null
    // The mart types this as an integer id; HubSpot's API takes it as a string.
    const asString = String(contactId).trim()
    return asString === '' ? null : asString
  }
}
