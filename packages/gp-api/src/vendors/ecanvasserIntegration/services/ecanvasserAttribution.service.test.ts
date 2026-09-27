import { useTestService } from '@/test-service'
import { ForbiddenException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  // vitest is configured with clearMocks (call history) but not restoreMocks
  // (implementations), so spies set with mockImplementation would otherwise
  // persist across tests in this file.
  afterEach(() => {
    vi.restoreAllMocks()
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

    expect(first).toEqual({ matched: 1, skipped: 0, deferred: 0 })
    // Three arguments now: attribution resolves pro access once per call and
    // passes it in, rather than letting each lookup re-derive it.
    expect(lookup).toHaveBeenCalledWith(
      '5551234567',
      expect.anything(),
      expect.any(Boolean),
    )

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
    expect(rows[0]?.occurredAt.toISOString()).toBe('2026-03-01T12:00:00.000Z')
    expect(rows[0]?.metadata).toEqual({
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
    expect(second).toEqual({ matched: 0, skipped: 0, deferred: 0 })
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

    expect(result).toEqual({ matched: 0, skipped: 1, deferred: 0 })
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

    expect(result).toEqual({ matched: 0, skipped: 1, deferred: 0 })
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

    expect(result).toEqual({ matched: 0, skipped: 1, deferred: 0 })
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

    expect(result).toEqual({ matched: 0, skipped: 0, deferred: 0 })
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
      new ForbiddenException(
        'Search and segments are only available for pro campaigns',
      ),
    )

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      ecanvasser.contacts,
      ecanvasser.interactions,
    )

    expect(result).toEqual({ matched: 0, skipped: 0, deferred: 0 })
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

    expect(result).toEqual({ matched: 1, skipped: 0, deferred: 0 })
    expect(lookup).toHaveBeenCalledWith(
      '5557778888',
      expect.anything(),
      expect.any(Boolean),
    )
  })

  // Rows built in memory rather than seeded: these cases care about how many
  // lookups the loop starts, not about what is persisted.
  const contactRow = (externalId: number, id: number): EcanvasserContact =>
    ({
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      externalId,
      firstName: 'John',
      lastName: 'Smith',
      type: 'Resident',
      homePhone: null,
      mobilePhone: `555000${String(externalId).padStart(4, '0')}`,
      email: null,
      actionId: null,
      lastInteractionId: null,
      createdBy: 0,
      ecanvasserId: 1,
      ecanvasserHouseId: null,
    }) as EcanvasserContact

  const interactionRow = (
    externalId: number,
    contactId: number,
    id: number,
  ): EcanvasserInteraction =>
    ({
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      externalId,
      type: 'Canvass',
      rating: null,
      date: new Date('2026-03-01T12:00:00.000Z'),
      status: 'Active',
      contactId,
      createdBy: 0,
      notes: null,
      source: null,
      ecanvasserId: 1,
    }) as EcanvasserInteraction

  it('stops starting lookups once the deadline has passed and reports the remainder', async () => {
    const { campaignId, organization } = await seedCampaign('deadline-stop')

    const contactRows = [1, 2, 3, 4].map((n) => contactRow(200 + n, n))
    const interactionRows = [1, 2, 3, 4].map((n) =>
      interactionRow(910 + n, 200 + n, n),
    )

    // Each lookup pushes the clock past the deadline the caller set, so the
    // second iteration finds the budget gone. Driving time through an injected
    // clock keeps the test deterministic and leaves the global Date.now (which
    // Prisma reads for its own timeouts) alone.
    let now = 1_000_000
    const lookup = vi
      .spyOn(contacts, 'findPersonByPhone')
      .mockImplementation(async () => {
        now += 50_000
        return matchPerson('LAL-200', 'Smith')
      })

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      contactRows,
      interactionRows,
      { deadlineAt: now + 40_000, now: () => now },
    )

    // One lookup ran, then the budget was gone: 3 of the 4 are deferred.
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ matched: 1, skipped: 0, deferred: 3 })

    // The match that did happen is persisted — stopping early must not discard
    // completed work.
    const rows = await service.prisma.voterOutreachActivity.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
  })

  it('runs every interaction when no deadline is given', async () => {
    const { campaignId, organization } = await seedCampaign('deadline-absent')

    const contactRows = [1, 2, 3].map((n) => contactRow(300 + n, n))
    const interactionRows = [1, 2, 3].map((n) =>
      interactionRow(920 + n, 300 + n, n),
    )

    // Time races far ahead of any plausible budget; with no deadline passed in,
    // that must not matter.
    let now = 1_000_000
    const lookup = vi
      .spyOn(contacts, 'findPersonByPhone')
      .mockImplementation(async () => {
        now += 500_000
        return matchPerson('LAL-300', 'Smith')
      })

    const result = await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      contactRows,
      interactionRows,
      { now: () => now },
    )

    expect(lookup).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ matched: 3, skipped: 0, deferred: 0 })
  })

  it('resolves pro access once per call, not once per interaction', async () => {
    const { campaignId, organization } = await seedCampaign('pro-access-once')

    const contactRows = [1, 2, 3].map((n) => contactRow(400 + n, n))
    const interactionRows = [1, 2, 3].map((n) =>
      interactionRow(930 + n, 400 + n, n),
    )

    const resolveProAccess = vi
      .spyOn(contacts, 'resolveProAccess')
      .mockResolvedValue(true)
    const lookup = vi
      .spyOn(contacts, 'findPersonByPhone')
      .mockResolvedValue(matchPerson('LAL-400', 'Smith'))

    await attribution.attributeDoorKnocking(
      campaignId,
      organization,
      contactRows,
      interactionRows,
    )

    expect(resolveProAccess).toHaveBeenCalledTimes(1)
    // The resolved value reaches every lookup, so none of them re-derives it.
    expect(lookup).toHaveBeenCalledTimes(3)
    for (const call of lookup.mock.calls) {
      expect(call[2]).toBe(true)
    }
  })
})
