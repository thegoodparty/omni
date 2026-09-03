import { Inject, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { HubspotService } from '@/crm/hubspot.service'
import { CRMContactProperties } from '@/crm/crm.types'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { SegmentService } from '@/vendors/segment/segment.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ProfileClaimRequestSource } from '../../generated/prisma'
import { PERSON_PROFILES_DATABRICKS } from '../personProfiles.constants'
import {
  type ClaimRequestCrmSyncResult,
  type CompletionRequestEventResult,
  recordClaimRequestCrmSync,
  recordCompletionRequestContactGap,
  recordCompletionRequestEvent,
} from '../observability/person-profiles.metrics'
import { PersonLookupService } from './person-lookup.service'

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
 * The three answers the person mart can give about a subject's HubSpot contact.
 * `absent` is a fact about the CRM; `unavailable` is the absence of a fact.
 * See `resolveHubspotContactId` for why they must not be collapsed.
 */
type ContactLookup =
  | { status: 'found'; contactId: string }
  | { status: 'absent' }
  | { status: 'unavailable' }

/**
 * Everything a visitor's "ask this person to complete their profile" submission
 * owes the CRM. Two independent halves, because HubSpot needs the same fact in
 * two forms: a COUNT on the contact (`candidate_profile_requests`, written
 * straight through the HubSpot API) and an EVENT it can run a workflow off
 * (emitted to Segment, which is where marketing builds automation).
 *
 * The count keeps the candidate's HubSpot contact property
 * `candidate_profile_requests` in step with how many visitors have asked that
 * person to complete their public profile.
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
 * Best-effort throughout: everything here runs after the lead row is committed
 * and NEVER throws, so an outage at HubSpot, Segment, the warehouse, or
 * election-api can never fail a visitor's submission or surface an error on the
 * public page.
 */
@Injectable()
export class CrmPersonProfilesService extends createPrismaBase(
  MODELS.ProfileClaimRequest,
) {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly segment: SegmentService,
    private readonly personLookup: PersonLookupService,
    @Inject(PERSON_PROFILES_DATABRICKS)
    private readonly databricks: DatabricksProvider | null,
  ) {
    super()
  }

  /**
   * The whole CRM side-effect of one `notify` submission, for the controller to
   * fire and forget once the lead row is committed.
   *
   * The two halves are deliberately independent and settled separately: they
   * reach HubSpot by different routes (its REST API vs. Segment) and resolve
   * the contact by different keys (the warehouse's `hs_contact_id` vs. the
   * person's email address), so either can succeed while the other cannot, and
   * a visitor's submission must not depend on either.
   *
   * Their outcomes are only combined afterwards, to meter one thing neither can
   * see alone: an event sent for a subject the CRM held no contact for is a
   * contact the Segment destination is about to create, with the irreversible
   * attribution cost described on `CompletionRequestContactGapResult` in
   * person-profiles.metrics.
   */
  async handleNotifySubmitted(
    personId: string,
    claimRequestId: string,
  ): Promise<void> {
    const [syncOutcome, eventOutcome] = await Promise.allSettled([
      this.syncClaimRequestCount(personId),
      this.emitCompletionRequested(personId, claimRequestId),
    ])

    // Both halves swallow their own failures and resolve with a result, so a
    // rejection here would mean that guarantee regressed. Treat it as unknown
    // rather than reading a value off a rejected promise.
    const syncResult =
      syncOutcome.status === 'fulfilled' ? syncOutcome.value : 'failed'
    const eventResult =
      eventOutcome.status === 'fulfilled' ? eventOutcome.value : 'failed'

    if (eventResult !== 'sent') return

    recordCompletionRequestContactGap(
      syncResult === 'success'
        ? 'existing_contact'
        : syncResult === 'no_contact'
          ? 'new_contact'
          : // 'skipped', 'unresolved' or 'failed': the subject's contact status
            // was never established, so neither bucket would be a fact.
            'unknown',
    )
  }

  async syncClaimRequestCount(
    personId: string,
  ): Promise<ClaimRequestCrmSyncResult> {
    // Off-prod the HubSpot client is a no-op mock whose update() resolves
    // undefined; treating that as a real write would report success for
    // something that never happened.
    if (!this.hubspot.isConfigured) {
      this.logger.debug(
        { personId },
        'HubSpot not configured; skipping candidate_profile_requests sync',
      )
      recordClaimRequestCrmSync('skipped')
      return 'skipped'
    }

    try {
      const lookup = await this.resolveHubspotContactId(personId)

      if (lookup.status === 'unavailable') {
        this.logger.debug(
          { personId },
          'Person mart unavailable; skipping candidate_profile_requests sync',
        )
        recordClaimRequestCrmSync('unresolved')
        return 'unresolved'
      }

      if (lookup.status === 'absent') {
        // Expected for anyone the CRM has never heard of, which is most of the
        // civics spine. Nothing is created here on purpose: a visitor nudging
        // someone should not mint a CRM contact for a person who never opted
        // into anything.
        this.logger.info(
          { personId },
          'No HubSpot contact for person; skipping candidate_profile_requests sync',
        )
        recordClaimRequestCrmSync('no_contact')
        return 'no_contact'
      }

      const { contactId } = lookup

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
      return 'success'
    } catch (error) {
      this.logger.error(
        { error, personId },
        'candidate_profile_requests sync failed (non-fatal)',
      )
      recordClaimRequestCrmSync('failed')
      return 'failed'
    }
  }

  /**
   * Emits the Segment event the HubSpot workflow sends the "complete your
   * profile" email off.
   *
   * WHY THE EVENT CARRIES AN EMAIL ADDRESS: the workflow has to land on the
   * subject's HubSpot contact, and `personId` cannot get it there — it is not a
   * unique property in HubSpot, so there is no 1:1 contact to resolve it to.
   * Email is unique over there, so the address IS the join key, and without it
   * the event arrives associated with nobody and no email can be sent. It rides
   * in `context.traits.email`, which is what the HubSpot destination matches
   * contacts on, rather than in the event properties, which would additionally
   * store the address as a custom-event property for no benefit.
   *
   * WHY THIS IS SERVER-SIDE: gp-marketing already fires a browser-side Segment
   * event for the same submission ('Person Profile Notify Submitted'), and
   * adding the address there is what we are avoiding — it would put candidates'
   * email addresses in a public page's network traffic and in every client-side
   * Segment destination. election-api will only serve `Person.email` over M2M
   * for exactly this reason (see PERSON_PII_COLUMNS), so the event that carries
   * it has to originate here. The two events are not duplicates: the browser one
   * measures the funnel with page context, this one routes the CRM.
   *
   * No address means no event. HubSpot cannot associate an unroutable event
   * with anyone, so sending it would only add an orphan record to the CRM.
   *
   * WHY THIS MINTS CONTACTS WHERE ITS SIBLING REFUSES TO: `syncClaimRequestCount`
   * writes nothing for a subject the CRM has never seen, on the grounds that a
   * visitor nudging someone should not create a record for them. This half
   * cannot honor that and still work — an event is only deliverable if HubSpot
   * has a contact, so for exactly that population Segment's cloud-mode
   * destination creates one. The cost is irreversible and worth stating: such a
   * contact is attributed to HubSpot's offline sources, and original source is
   * immutable after creation, so a candidate nudged before they sign up will
   * never be credited to the paid or organic session that actually brought them
   * in (the same problem the `hutk` Forms API path exists to avoid — see the
   * HubSpot integration doc). Accepted deliberately: an undeliverable nudge is
   * worth less than the attribution. Metered as
   * `person_profile_completion_request_contact_gap_count_total{result="new_contact"}`
   * so the size of that trade is visible rather than inferred.
   *
   * Best-effort, like its sibling: it never throws. `claimRequestId` is the
   * Segment messageId, which collapses a replay onto one email within Segment's
   * deduplication window (~24h) — long enough for any retry, not a permanent
   * guarantee.
   */
  private async emitCompletionRequested(
    personId: string,
    claimRequestId: string,
  ): Promise<CompletionRequestEventResult> {
    try {
      const email = await this.personLookup.resolveContactEmail(personId)
      if (!email) {
        this.logger.info(
          { personId },
          'No contact email for person; skipping profile completion request event',
        )
        recordCompletionRequestEvent('no_email')
        return 'no_email'
      }

      await this.segment.trackAnonymousEvent(
        // Stable per subject, so repeat nudges about one person collapse onto a
        // single Segment profile instead of one per submission.
        personId,
        EVENTS.PersonProfiles.CompletionRequested,
        { personId, claimRequestId },
        { email },
        claimRequestId,
      )

      this.logger.debug(
        { personId, claimRequestId },
        'Emitted profile completion request event',
      )
      recordCompletionRequestEvent('sent')
      return 'sent'
    } catch (error) {
      this.logger.error(
        { error, personId },
        'Profile completion request event failed (non-fatal)',
      )
      recordCompletionRequestEvent('failed')
      return 'failed'
    }
  }

  /**
   * personId → HubSpot contact id, via the civics person mart.
   *
   * There is no closer source, and this deliberately does not go via the email
   * address `emitCompletionRequested` resolves: gp-api holds a HubSpot contact
   * id only for its own users (`User.metaData.hubspotId`), and the people these
   * forms appear on are by definition unclaimed, so they have no user. Searching
   * HubSpot by email would be a second round trip to guess at what the warehouse
   * already knows for certain, and it would write the count to whatever contact
   * happened to match rather than to the one the person mart vouches for.
   *
   * Never throws for an environment without the warehouse: it reports
   * `unavailable` and the feature is simply inert.
   *
   * WHY THIS DISTINGUISHES `absent` FROM `unavailable`: both mean "do not write
   * the count", so the counter alone would not care. But "the mart vouches that
   * this person has no contact" is what tells the event half that Segment is
   * about to CREATE one, and "we never got to ask" says nothing about the CRM at
   * all. Collapsing them would report an irreversible attribution cost every
   * time the warehouse was merely unconfigured.
   */
  private async resolveHubspotContactId(
    personId: string,
  ): Promise<ContactLookup> {
    if (!this.databricks) return { status: 'unavailable' }
    // Upstream DTOs reject a non-UUID personId, so this is a guard rather than
    // an expected path — but it skips the query, so the CRM is still unread.
    if (!UUID_PATTERN.test(personId)) return { status: 'unavailable' }

    const { rows } = await this.databricks.query(
      `SELECT hs_contact_id FROM ${CIVICS_PEOPLE_TABLE} ` +
        `WHERE gp_person_id = '${personId}' LIMIT 1`,
    )

    const contactId = rows[0]?.hs_contact_id
    if (contactId === null || contactId === undefined) {
      return { status: 'absent' }
    }
    // The mart types this as an integer id; HubSpot's API takes it as a string.
    const asString = String(contactId).trim()
    return asString === ''
      ? { status: 'absent' }
      : { status: 'found', contactId: asString }
  }
}
