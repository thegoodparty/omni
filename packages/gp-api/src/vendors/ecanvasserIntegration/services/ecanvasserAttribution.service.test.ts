import { useTestService } from '@/test-service'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EcanvasserContact,
  EcanvasserInteraction,
  OutreachType,
  VoterOutreachAttributionSource,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PersonOutput } from '@/contacts/schemas/person.schema'
import { ECANVASSER_ATTRIBUTION_SERVICE } from '../ecanvasserIntegration.types'
import type { EcanvasserAttributionService } from './ecanvasserAttribution.service'

const service = useTestService()

// Attribution only reads lalVoterId + lastName off the matched person; the rest
// of PersonOutput is irrelevant here, so build a minimal stand-in.
const matchPerson = (lalVoterId: string, lastName: string | null) =>
  ({ lalVoterId, lastName }) as unknown as PersonOutput

describe('EcanvasserAttributionService', () => {
  let attribution: EcanvasserAttributionService
  let contacts: ContactsService

  const seedCampaign = async (slug: string) => {
    const organization = await service.prisma.organization.create({
      data: { slug: `org-${slug}`, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: { userId: service.user.id, slug, organizationSlug: `org-${slug}` },
    })
    return { campaignId: campaign.id, organization }
  }

  const seedEcanvasser = async (
    campaignId: number,
    contact: Partial<EcanvasserContact> & {
      externalId: number
      lastName: string
    },
    interaction: Partial<EcanvasserInteraction> & {
      externalId: number
      contactId: number
    },
  ) => {
    const ecanvasser = await service.prisma.ecanvasser.create({
      data: {
        campaignId,
        apiKey: 'test-key',
        contacts: {
          create: [
            {
              externalId: contact.externalId,
              firstName: contact.firstName ?? 'John',
              lastName: contact.lastName,
              type: 'Resident',
              mobilePhone: contact.mobilePhone ?? null,
              homePhone: contact.homePhone ?? null,
              createdBy: 0,
            },
          ],
        },
        interactions: {
          create: [
            {
              externalId: interaction.externalId,
              type: 'Canvass',
              contactId: interaction.contactId,
              createdBy: 0,
              date: interaction.date ?? new Date('2026-03-01T12:00:00.000Z'),
              rating: interaction.rating ?? null,
            },
          ],
        },
      },
      include: { contacts: true, interactions: true },
    })
    return ecanvasser
  }

  beforeEach(() => {
    attribution = service.app.get<EcanvasserAttributionService>(
      ECANVASSER_ATTRIBUTION_SERVICE,
    )
    contacts = service.app.get(ContactsService)
  })

  it('emits exactly one activity for a confident match and none on re-run', async () => {
    const { campaignId, organization } = await seedCampaign('match-once')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 100, lastName: 'Smith', mobilePhone: '5551234567' },
      {
        externalId: 900,
        contactId: 100,
        date: new Date('2026-03-01T12:00:00.000Z'),
        rating: 4,
      },
    )

    const lookup = vi
      .spyOn(contacts, 'findPersonByPhone')
      .mockResolvedValue(matchPerson('LAL-777', 'Smith'))

    const first = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(first).toEqual({ matched: 1, skipped: 0 })
    expect(lookup).toHaveBeenCalledWith('5551234567', expect.anything())

    const rows = await service.prisma.voterOutreachActivity.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      lalVoterId: 'LAL-777',
      outreachType: OutreachType.doorKnocking,
      attributionSource: VoterOutreachAttributionSource.recipient,
      sourceId: '900',
    })
    expect(rows[0].occurredAt.toISOString()).toBe('2026-03-01T12:00:00.000Z')
    expect(rows[0].metadata).toEqual({
      ecanvasserInteractionId: 900,
      rating: 4,
    })

    // Re-run: the interaction is already attributed, so no second lookup and no
    // duplicate row.
    lookup.mockClear()
    const second = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )
    expect(second).toEqual({ matched: 0, skipped: 0 })
    expect(lookup).not.toHaveBeenCalled()

    const afterRerun = await service.prisma.voterOutreachActivity.count({
      where: { campaignId },
    })
    expect(afterRerun).toBe(1)
  })

  it('skips and counts an interaction with no voter match', async () => {
    const { campaignId, organization } = await seedCampaign('no-match')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 101, lastName: 'Smith', mobilePhone: '5550000000' },
      { externalId: 901, contactId: 101 },
    )

    vi.spyOn(contacts, 'findPersonByPhone').mockResolvedValue(null)

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 1 })
    const count = await service.prisma.voterOutreachActivity.count({
      where: { campaignId },
    })
    expect(count).toBe(0)
  })

  it('skips when the matched voter last name does not match the contact', async () => {
    const { campaignId, organization } = await seedCampaign('name-mismatch')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 102, lastName: 'Smith', mobilePhone: '5551112222' },
      { externalId: 902, contactId: 102 },
    )

    vi.spyOn(contacts, 'findPersonByPhone').mockResolvedValue(
      matchPerson('LAL-999', 'Jones'),
    )

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 1 })
    const count = await service.prisma.voterOutreachActivity.count({
      where: { campaignId },
    })
    expect(count).toBe(0)
  })

  it('skips a contact with no phone without calling the voter lookup', async () => {
    const { campaignId, organization } = await seedCampaign('no-phone')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 103, lastName: 'Smith' },
      { externalId: 903, contactId: 103 },
    )

    const lookup = vi.spyOn(contacts, 'findPersonByPhone')

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 1 })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('stops without throwing when the voter lookup is unavailable', async () => {
    const { campaignId, organization } = await seedCampaign('lookup-down')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 104, lastName: 'Smith', mobilePhone: '5553334444' },
      { externalId: 904, contactId: 104 },
    )

    vi.spyOn(contacts, 'findPersonByPhone').mockRejectedValue(
      new Error('people-api down'),
    )

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 0 })
    const count = await service.prisma.voterOutreachActivity.count({
      where: { campaignId },
    })
    expect(count).toBe(0)
  })

  it('stops without throwing when the campaign is ineligible (non-pro)', async () => {
    const { campaignId, organization } = await seedCampaign('ineligible')
    const ecanvasser = await seedEcanvasser(
      campaignId,
      { externalId: 106, lastName: 'Smith', mobilePhone: '5556667777' },
      { externalId: 906, contactId: 106 },
    )

    vi.spyOn(contacts, 'findPersonByPhone').mockRejectedValue(
      new BadRequestException(
        'Search and segments are only available for pro campaigns',
      ),
    )

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 0 })
    const count = await service.prisma.voterOutreachActivity.count({
      where: { campaignId },
    })
    expect(count).toBe(0)
  })

  it('prefers the phone-bearing row when an externalId is duplicated', async () => {
    const { campaignId, organization } = await seedCampaign('dup-contact')
    // A single fetched batch can carry the same externalId twice (the API
    // returns a contact more than once across an overlapping window, or twice
    // within one page set). The DB unique index now stops both rows from
    // persisting, but attribution still resolves the in-memory batch: the
    // newer (higher id) row has no phone, the older one carries the phone, and
    // attribution must use the phone-bearing row, not the most recent one.
    const phoneRow: EcanvasserContact = {
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      externalId: 105,
      firstName: 'John',
      lastName: 'Smith',
      type: 'Resident',
      gender: null,
      dateOfBirth: null,
      yearOfBirth: null,
      houseId: null,
      uniqueIdentifier: null,
      organization: null,
      volunteer: false,
      deceased: false,
      donor: false,
      homePhone: null,
      mobilePhone: '5557778888',
      email: null,
      actionId: null,
      lastInteractionId: null,
      createdBy: 0,
      ecanvasserId: 1,
      ecanvasserHouseId: null,
    }
    const noPhoneRow: EcanvasserContact = {
      ...phoneRow,
      id: 2,
      mobilePhone: null,
    }
    const interaction: EcanvasserInteraction = {
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      externalId: 905,
      type: 'Canvass',
      rating: null,
      date: new Date('2026-03-01T12:00:00.000Z'),
      status: 'Active',
      contactId: 105,
      createdBy: 0,
      notes: null,
      source: null,
      ecanvasserId: 1,
    }

    const lookup = vi
      .spyOn(contacts, 'findPersonByPhone')
      .mockResolvedValue(matchPerson('LAL-105', 'Smith'))

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      [noPhoneRow, phoneRow],
      [interaction],
    )

    expect(result).toEqual({ matched: 1, skipped: 0 })
    expect(lookup).toHaveBeenCalledWith('5557778888', expect.anything())
  })
})
