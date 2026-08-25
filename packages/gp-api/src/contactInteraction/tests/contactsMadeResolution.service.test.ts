import { useTestService } from '@/test-service'
import {
  DoorKnockOutcome,
  OutreachType,
  PhoneBankCallOutcome,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '../services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '../services/contactInteractionText.service'
import { ContactsMadeResolutionService } from '../services/contactsMadeResolution.service'

const service = useTestService()

// ENG-10839/ENG-10944: "a contact" is every logged interaction ROW across
// text/robocall/door-knock/phone-banking, regardless of outcome — a person
// with 1 text + 1 door knock has 2 contacts, same as 2 texts.
describe('ContactsMadeResolutionService', () => {
  let resolution: ContactsMadeResolutionService
  let texts: ContactInteractionTextService
  let robocalls: ContactInteractionRobocallService
  let doorKnocks: ContactInteractionDoorKnockService

  const seedOrganization = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return slug
  }

  const seedOutreach = async (
    organizationSlug: string,
    outreachType: OutreachType,
  ) => {
    const campaign = await service.prisma.campaign.upsert({
      where: { organizationSlug },
      create: {
        userId: service.user.id,
        slug: `campaign-${organizationSlug}`,
        organizationSlug,
      },
      update: {},
    })
    const outreach = await service.prisma.outreach.create({
      data: { campaignId: campaign.id, outreachType, organizationSlug },
    })
    return outreach.id
  }

  const seedText = (organizationSlug: string, personId: string) =>
    texts.create({ organizationSlug, personId, occurredAt: new Date() })

  const seedRobocall = (organizationSlug: string, personId: string) =>
    robocalls.create({ organizationSlug, personId, occurredAt: new Date() })

  const seedDoorKnock = (organizationSlug: string, personId: string) =>
    doorKnocks.create({
      organizationSlug,
      personId,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
    })

  const seedPhoneBanking = (organizationSlug: string, personId: string) =>
    service.prisma.contactInteractionPhoneBanking.create({
      data: {
        organizationSlug,
        personId,
        occurredAt: new Date(),
        outcome: PhoneBankCallOutcome.answered,
      },
    })

  beforeEach(() => {
    resolution = service.app.get(ContactsMadeResolutionService)
    texts = service.app.get(ContactInteractionTextService)
    robocalls = service.app.get(ContactInteractionRobocallService)
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
  })

  describe('personIdsByContactCount', () => {
    it('counts 1 text + 1 robocall as bucket 2 (a cross-channel sum)', async () => {
      const org = await seedOrganization('org-cross-channel-2')
      await seedOutreach(org, OutreachType.text)
      await seedText(org, 'p-two')
      await seedRobocall(org, 'p-two')

      const bucket2 = await resolution.personIdsByContactCount(org, [2])
      expect(bucket2.has('p-two')).toBe(true)

      const bucket1 = await resolution.personIdsByContactCount(org, [1])
      expect(bucket1.has('p-two')).toBe(false)
    })

    it('buckets a person with exactly 5 interactions into "5+" but not exact buckets 1-4', async () => {
      const org = await seedOrganization('org-five-plus')
      for (let i = 0; i < 5; i += 1) {
        await seedDoorKnock(org, 'p-five')
      }

      const fivePlus = await resolution.personIdsByContactCount(org, [5])
      expect(fivePlus.has('p-five')).toBe(true)
      const exact4 = await resolution.personIdsByContactCount(org, [4])
      expect(exact4.has('p-five')).toBe(false)
    })

    it('is isolated per organization', async () => {
      const orgA = await seedOrganization('org-isolation-a')
      const orgB = await seedOrganization('org-isolation-b')
      await seedText(orgA, 'p-shared')

      const inA = await resolution.personIdsByContactCount(orgA, [1])
      const inB = await resolution.personIdsByContactCount(orgB, [1])
      expect(inA.has('p-shared')).toBe(true)
      expect(inB.has('p-shared')).toBe(false)
    })

    // ENG-10944: phone banking was the one contact_interaction_* table
    // missing from the UNION — a phone-banked voter matched bucket 0
    // forever regardless of how many calls were logged.
    it('counts a logged phone-banking call, moving the person from bucket 0 to bucket 1', async () => {
      const org = await seedOrganization('org-phone-banking')
      await seedPhoneBanking(org, 'p-phone-banked')

      const bucket1 = await resolution.personIdsByContactCount(org, [1])
      expect(bucket1.has('p-phone-banked')).toBe(true)

      const selectedZero = await resolution.resolveContactsMade(
        org,
        new Set([0]),
      )
      expect(selectedZero).toEqual({
        kind: 'filter',
        idFilter: { notIn: ['p-phone-banked'] },
      })
    })

    it('OR-composes multiple requested buckets in one query', async () => {
      const org = await seedOrganization('org-or-buckets')
      await seedText(org, 'p-one')
      await seedText(org, 'p-two')
      await seedRobocall(org, 'p-two')

      const oneOrTwo = await resolution.personIdsByContactCount(org, [1, 2])
      expect(oneOrTwo.has('p-one')).toBe(true)
      expect(oneOrTwo.has('p-two')).toBe(true)
    })
  })

  describe('resolveContactsMade', () => {
    it('selection excluding 0 resolves to an "in" filter over the union of buckets', async () => {
      const org = await seedOrganization('org-select-2')
      await seedText(org, 'p-two')
      await seedRobocall(org, 'p-two')
      await seedText(org, 'p-one')

      const result = await resolution.resolveContactsMade(org, new Set([2]))
      expect(result).toEqual({ kind: 'filter', idFilter: { in: ['p-two'] } })
    })

    it('selection {0} alone resolves to a "notIn" filter over everyone contacted', async () => {
      const org = await seedOrganization('org-select-0')
      await seedText(org, 'p-contacted')

      const result = await resolution.resolveContactsMade(org, new Set([0]))
      expect(result).toEqual({
        kind: 'filter',
        idFilter: { notIn: ['p-contacted'] },
      })
    })

    it('selection {0} with nobody ever contacted resolves to "none" (no constraint)', async () => {
      const org = await seedOrganization('org-select-0-empty')
      const result = await resolution.resolveContactsMade(org, new Set([0]))
      expect(result).toEqual({ kind: 'none' })
    })

    it('a bucket selection matching nobody resolves to "empty"', async () => {
      const org = await seedOrganization('org-select-3-empty')
      await seedText(org, 'p-one')
      const result = await resolution.resolveContactsMade(org, new Set([3]))
      expect(result).toEqual({ kind: 'empty' })
    })

    // {0, 3}: never-contacted plus exactly-3 — the mixed case that needs the
    // OR-of-id-sets override composition, since bucket-3 ids are a subset of
    // the contacted set being excluded.
    it('selection {0, 3} composes an override: exclude everyone contacted, include exactly-3', async () => {
      const org = await seedOrganization('org-select-0-and-3')
      for (let i = 0; i < 3; i += 1) {
        await seedDoorKnock(org, 'p-three')
      }
      await seedText(org, 'p-one')

      const result = await resolution.resolveContactsMade(org, new Set([0, 3]))
      expect(result).toEqual({
        kind: 'override',
        idOverrides: {
          include: ['p-three'],
          exclude: expect.arrayContaining(['p-three', 'p-one']),
        },
      })
    })

    it('an empty selection resolves to "none"', async () => {
      const org = await seedOrganization('org-select-empty')
      const result = await resolution.resolveContactsMade(org, new Set())
      expect(result).toEqual({ kind: 'none' })
    })
  })
})
