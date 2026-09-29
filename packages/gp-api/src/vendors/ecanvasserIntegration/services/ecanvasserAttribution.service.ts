import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  EcanvasserContact,
  EcanvasserInteraction,
  Organization,
  OutreachType,
  VoterOutreachAttributionSource,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PersonOutput } from '@/contacts/schemas/person.schema'
import { VoterOutreachActivityService } from '@/voterOutreachActivity/services/voterOutreachActivity.service'

type AttributionResult = {
  matched: number
  skipped: number
  /**
   * Interactions the loop never reached because the time budget ran out. An
   * upper bound on the work left: some would need no People-API call.
   */
  deferred: number
}

// Door-knock attribution: turn synced eCanvasser interactions into per-voter
// VoterOutreachActivity rows. eCanvasser records carry no lalVoterId, so each
// interaction's contact is matched to a People-API voter by phone + last name.
// Matching is intentionally conservative — a wrong tag is worse than a miss —
// so an interaction is attributed only when a phone lookup returns a voter
// whose last name matches the contact's. Everything else is skipped and counted.
@Injectable()
export class EcanvasserAttributionService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly voterOutreachActivity: VoterOutreachActivityService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EcanvasserAttributionService.name)
  }

  async attributeDoorKnocking(
    campaignId: number,
    organization: Organization,
    contacts: EcanvasserContact[],
    interactions: EcanvasserInteraction[],
    options: {
      // Epoch ms after which no further voter lookup is started. Attribution
      // runs inline in POST /v1/ecanvasser/:id/sync, and every interaction that
      // is not already attributed costs a People-API round trip (~800ms against
      // Databricks), so a campaign with a few thousand of them cannot finish
      // inside the gateway's ~120s idle timeout. Without a deadline the gateway
      // severs the connection mid-loop: the caller gets no status at all, the
      // sync looks broken even though its data committed before attribution
      // started, and the user retries — paying the whole cost again from the top.
      //
      // Stopping early loses no work that was done: each match is written as it
      // is found and skipped on the next run. Optional so a caller with no
      // client waiting can opt out; every caller today is behind an HTTP request
      // and passes one.
      deadlineAt?: number
      // Clock, injectable for tests. A test needs to move time without stubbing
      // global Date.now, which Prisma also reads for its pool and query
      // timeouts — freezing or jumping that under a live connection is a
      // different test than the one being written.
      now?: () => number
    } = {},
  ): Promise<AttributionResult> {
    const { deadlineAt, now = Date.now } = options
    // The delta sync appends contacts (create, not upsert), so the same eCanvasser
    // contact can appear as more than one row across sync windows. Resolve each
    // externalId deterministically — prefer a row that has a phone, then the most
    // recently synced (highest id) — so attribution never picks a stale phone by
    // accident (a wrong voter match is worse than a miss).
    const contactByExternalId = new Map<number, EcanvasserContact>()
    for (const contact of contacts) {
      if (contact.externalId === null) continue
      const existing = contactByExternalId.get(contact.externalId)
      if (!existing || this.isFresherContact(contact, existing)) {
        contactByExternalId.set(contact.externalId, contact)
      }
    }

    // Skip interactions already attributed in a prior sync so a re-sync makes no
    // redundant People-API calls. The DB upsert below is still the correctness
    // guarantee against concurrent retries; this is purely an efficiency gate.
    const alreadyAttributed = await this.voterOutreachActivity.findSourceIds(
      campaignId,
      OutreachType.doorKnocking,
    )

    // Pro access depends only on the organization, so resolve it at most once
    // per call and hand it to every lookup instead of paying a campaign query
    // per interaction — the batch-caller path ContactsService.resolveProAccess
    // exists for. Resolved lazily so a sync with nothing left to attribute (the
    // common case once a campaign is caught up, and every campaign on a syncAll
    // pass) still costs no query at all.
    let proAccessPromise: Promise<boolean> | undefined
    const resolveProAccess = () =>
      (proAccessPromise ??= this.contacts.resolveProAccess(organization))

    let matched = 0
    let skipped = 0
    let deferred = 0

    for (const [index, interaction] of interactions.entries()) {
      if (interaction.externalId === null) continue
      const sourceId = interaction.externalId.toString()
      if (alreadyAttributed.has(sourceId)) continue

      const contact = contactByExternalId.get(interaction.contactId)
      const phone = contact ? this.phoneOf(contact) : null
      if (!contact || !phone) {
        skipped++
        continue
      }

      // Checked after the local filters above, not before them, so the cheap
      // in-memory work still drains: an interaction that needs no lookup is
      // still counted correctly after the budget is gone. `deferred` is
      // therefore an upper bound on the remaining work — some of those
      // interactions would have been skipped or already-attributed without
      // costing a call.
      if (deadlineAt !== undefined && now() >= deadlineAt) {
        deferred = interactions.length - index
        this.logger.warn(
          { campaignId, matched, skipped, deferred },
          'Door-knock attribution stopped early: time budget exhausted',
        )
        break
      }

      // Resolved before the try below so a failure here is not misreported as
      // "voter lookup unavailable": this is a local Prisma read, not the
      // People-API call that message describes. Memoised, so only the first
      // interaction that needs it pays.
      const proAccess = await resolveProAccess()

      let person: PersonOutput | null
      try {
        person = await this.contacts.findPersonByPhone(
          phone,
          organization,
          proAccess,
        )
      } catch (error) {
        // A throw here is campaign-wide, not specific to this interaction, so
        // stop rather than fail the sync or hammer a failing dependency once per
        // interaction. A ForbiddenException (the pro gate) or a
        // BadRequestException (voter data unavailable) is a permanent
        // eligibility state, not an outage — log it distinctly so a recurring
        // warning doesn't read as People-API downtime operators should
        // investigate.
        if (
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          this.logger.warn(
            { error, campaignId },
            'Door-knock attribution skipped: campaign not eligible for voter lookup',
          )
        } else {
          this.logger.warn(
            { error, campaignId },
            'Door-knock attribution stopped: voter lookup unavailable',
          )
        }
        break
      }

      if (!this.isConfidentMatch(person, contact)) {
        skipped++
        continue
      }

      await this.voterOutreachActivity.recordActivityIdempotent({
        campaignId,
        lalVoterId: person.lalVoterId,
        outreachType: OutreachType.doorKnocking,
        attributionSource: VoterOutreachAttributionSource.recipient,
        occurredAt: interaction.date,
        sourceId,
        metadata: {
          ecanvasserInteractionId: interaction.externalId,
          rating: interaction.rating,
        },
      })
      matched++
    }

    this.logger.info(
      { campaignId, matched, skipped, deferred },
      'Door-knock attribution complete',
    )
    return { matched, skipped, deferred }
  }

  private phoneOf(contact: EcanvasserContact): string | null {
    return contact.mobilePhone ?? contact.homePhone ?? null
  }

  // Pick between two contact rows sharing an externalId: a row with a phone beats
  // one without; otherwise the higher id (most recently synced) wins.
  private isFresherContact(
    candidate: EcanvasserContact,
    current: EcanvasserContact,
  ): boolean {
    const candidateHasPhone = this.phoneOf(candidate) !== null
    const currentHasPhone = this.phoneOf(current) !== null
    if (candidateHasPhone !== currentHasPhone) return candidateHasPhone
    return candidate.id > current.id
  }

  private isConfidentMatch(
    person: PersonOutput | null,
    contact: EcanvasserContact,
  ): person is PersonOutput {
    if (!person?.lastName) return false
    return (
      person.lastName.trim().toLowerCase() ===
      contact.lastName.trim().toLowerCase()
    )
  }
}
