import { Injectable } from '@nestjs/common'
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
    const contactByExternalId = new Map<number, EcanvasserContact>()
    for (const contact of contacts) {
      if (contact.externalId !== null) {
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
      const phone = contact?.mobilePhone ?? contact?.homePhone ?? null
      if (!contact || !phone) {
        skipped++
        continue
      }

      let person: PersonOutput | null
      try {
        person = await this.contacts.findPersonByPhone(phone, organization)
      } catch (error) {
        // A throw here is campaign-wide (voter data ineligible, non-pro, or
        // People-API unavailable), not specific to this interaction. Stop and
        // let the next sync retry rather than failing the sync or hammering a
        // failing dependency once per interaction.
        this.logger.warn(
          { error, campaignId },
          'Door-knock attribution stopped: voter lookup unavailable',
        )
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
