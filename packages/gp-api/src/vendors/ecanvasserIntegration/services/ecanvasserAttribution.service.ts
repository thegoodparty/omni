import { BadRequestException, Injectable } from '@nestjs/common'
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

type AttributionResult = { matched: number; skipped: number }

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
  ): Promise<AttributionResult> {
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

    let matched = 0
    let skipped = 0

    for (const interaction of interactions) {
      if (interaction.externalId === null) continue
      const sourceId = interaction.externalId.toString()
      if (alreadyAttributed.has(sourceId)) continue

      const contact = contactByExternalId.get(interaction.contactId)
      const phone = contact ? this.phoneOf(contact) : null
      if (!contact || !phone) {
        skipped++
        continue
      }

      let person: PersonOutput | null
      try {
        person = await this.contacts.findPersonByPhone(phone, organization)
      } catch (error) {
        // A throw here is campaign-wide, not specific to this interaction, so
        // stop rather than fail the sync or hammer a failing dependency once per
        // interaction. A BadRequestException is a permanent eligibility state
        // (non-pro campaign / voter data unavailable), not an outage — log it
        // distinctly so a recurring warning doesn't read as People-API downtime
        // operators should investigate.
        if (error instanceof BadRequestException) {
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
      { campaignId, matched, skipped },
      'Door-knock attribution complete',
    )
    return { matched, skipped }
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
