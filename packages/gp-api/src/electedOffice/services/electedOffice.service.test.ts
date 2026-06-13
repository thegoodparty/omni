import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { addYears } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectedOfficeService } from './electedOffice.service'

const service = useTestService()

describe('ElectedOfficeService.create', () => {
  let electedOffices: ElectedOfficeService
  let elections: ElectionsService

  beforeEach(() => {
    electedOffices = service.app.get(ElectedOfficeService)
    elections = service.app.get(ElectionsService)
    // The schedule dispatch is an external (queue) side effect; stub it so the
    // tests stay hermetic. create() swallows dispatch errors anyway.
    vi.spyOn(
      service.app.get(MeetingBriefingsService),
      'onElectedOfficeCreated',
    ).mockResolvedValue(undefined as never)
  })

  const seedCampaignWithRace = async (raceId: string) => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-1', ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'candidate-campaign',
        details: { raceId },
        organizationSlug: 'campaign-1',
      },
    })
    return campaign.id
  }

  it('derives term fields from the position frequency and creates the org', async () => {
    vi.spyOn(elections, 'getElectionFrequencyByBrHashId').mockResolvedValue({
      frequency: [4],
      electionDate: '2024-11-05T00:00:00.000Z',
    })
    const campaignId = await seedCampaignWithRace('br-hash-4yr')

    const office = await electedOffices.create({
      userId: service.user.id,
      campaignId,
      orgData: {
        positionId: 'br-pos-7',
        customPositionName: 'City Council',
        overrideDistrictId: 'district-7',
      },
    })

    expect(office.isActive).toBe(true)
    expect(office.electedDate).toEqual(new Date('2024-11-05T00:00:00.000Z'))
    expect(office.termStartAt).toEqual(new Date('2024-11-05T00:00:00.000Z'))
    expect(office.termEndAt).toEqual(new Date('2028-11-05T00:00:00.000Z'))
    expect(office.termLengthDays).toBe(1461)

    const org = await service.prisma.organization.findUnique({
      where: { slug: office.organizationSlug },
    })
    expect(org).toMatchObject({
      ownerId: service.user.id,
      positionId: 'br-pos-7',
      customPositionName: 'City Council',
      overrideDistrictId: 'district-7',
    })
  })

  it('uses the longest gap for a staggered [2, 4] cadence', async () => {
    vi.spyOn(elections, 'getElectionFrequencyByBrHashId').mockResolvedValue({
      frequency: [2, 4],
      electionDate: '2024-11-05T00:00:00.000Z',
    })
    const campaignId = await seedCampaignWithRace('br-hash-staggered')

    const office = await electedOffices.create({
      userId: service.user.id,
      campaignId,
    })

    expect(office.termEndAt).toEqual(new Date('2028-11-05T00:00:00.000Z'))
    expect(office.termLengthDays).toBe(1461)
  })

  it('leaves term fields null when no frequency resolves', async () => {
    const office = await electedOffices.create({ userId: service.user.id })

    expect(office.isActive).toBe(true)
    expect(office.termEndAt).toBeNull()
    expect(office.termLengthDays).toBeNull()
  })

  it('returns the held office without creating a second active one', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-existing', ownerId: service.user.id },
    })
    const existing = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: 'eo-existing',
        isActive: true,
        termEndAt: addYears(new Date(), 2),
      },
    })

    const result = await electedOffices.create({ userId: service.user.id })

    expect(result.id).toBe(existing.id)
    expect(await service.prisma.electedOffice.count()).toBe(1)
    expect(
      await service.prisma.organization.count({
        where: { ownerId: service.user.id },
      }),
    ).toBe(1)
  })

  it('still creates an office when the user only holds past offices', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-past', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: 'eo-past',
        isActive: true,
        termEndAt: addYears(new Date(), -1),
      },
    })

    await electedOffices.create({ userId: service.user.id })

    expect(await service.prisma.electedOffice.count()).toBe(2)
  })

  it('serializes concurrent creates into a single active office', async () => {
    // Two simultaneous first-office submits for the same user. The advisory
    // lock + in-transaction held-office recheck must collapse them to one
    // office and one organization — task 01 removed the unique constraint
    // that used to backstop this, so the lock is the only guard.
    const [a, b] = await Promise.all([
      electedOffices.create({ userId: service.user.id }),
      electedOffices.create({ userId: service.user.id }),
    ])

    expect(a.id).toBe(b.id)
    expect(await service.prisma.electedOffice.count()).toBe(1)
    expect(
      await service.prisma.organization.count({
        where: { ownerId: service.user.id },
      }),
    ).toBe(1)
  })

  it('dispatches the schedule after creating an office', async () => {
    const dispatch = vi.spyOn(
      service.app.get(MeetingBriefingsService),
      'onElectedOfficeCreated',
    )

    const office = await electedOffices.create({ userId: service.user.id })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: office.id }),
    )
  })
})

describe('ElectedOfficeService.update', () => {
  it('updates an office field through the real model', async () => {
    const electedOffices = service.app.get(ElectedOfficeService)
    await service.prisma.organization.create({
      data: { slug: 'eo-update', ownerId: service.user.id },
    })
    const office = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: 'eo-update' },
    })

    const swornInDate = new Date('2025-01-06T00:00:00.000Z')
    const updated = await electedOffices.update({
      where: { id: office.id },
      data: { swornInDate },
    })

    expect(updated.swornInDate).toEqual(swornInDate)
  })
})
