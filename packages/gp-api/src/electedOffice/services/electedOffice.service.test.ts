import { useTestService } from '@/test-service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectedOfficeService } from './electedOffice.service'

const service = useTestService()

describe('ElectedOfficeService.create', () => {
  let electedOffices: ElectedOfficeService

  beforeEach(() => {
    electedOffices = service.app.get(ElectedOfficeService)
    // The schedule dispatch is an external (queue) side effect; stub it so the
    // tests stay hermetic. create() swallows dispatch errors anyway.
    vi.spyOn(
      service.app.get(MeetingBriefingsService),
      'onElectedOfficeCreated',
    ).mockResolvedValue(undefined as never)
  })

  it('creates an office and its organization from the supplied data', async () => {
    const office = await electedOffices.create({
      userId: service.user.id,
      // Term dates are to-the-day values from onboarding input / the
      // BallotReady office-holder prefill — never derived from cadence.
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
      orgData: {
        positionId: 'br-pos-7',
        customPositionName: 'City Council',
        overrideDistrictId: 'district-7',
      },
    })

    expect(office.isActive).toBe(true)
    expect(office.termStartDate).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(office.termEndDate).toEqual(new Date('2029-01-01T00:00:00.000Z'))
    // Derived precisely from the two dates (4 years incl. the 2028 leap day).
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

  it('honors an explicitly supplied termLengthDays over the derived value', async () => {
    const office = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
      termLengthDays: 1000,
    })

    expect(office.termLengthDays).toBe(1000)
  })

  it('leaves term fields null when no term dates are provided', async () => {
    const office = await electedOffices.create({ userId: service.user.id })

    expect(office.isActive).toBe(true)
    expect(office.termStartDate).toBeNull()
    expect(office.termEndDate).toBeNull()
    expect(office.termLengthDays).toBeNull()
  })

  it('allows a second office whose term does not overlap an existing one', async () => {
    await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2021-01-01T00:00:00.000Z'),
      termEndDate: new Date('2024-12-31T00:00:00.000Z'),
    })

    const second = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2028-12-31T00:00:00.000Z'),
    })

    expect(await service.prisma.electedOffice.count()).toBe(2)
    expect(second.termStartDate).toEqual(new Date('2025-01-01T00:00:00.000Z'))
  })

  it('rejects a second office whose term overlaps an existing one', async () => {
    await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
    })

    await expect(
      electedOffices.create({
        userId: service.user.id,
        termStartDate: new Date('2027-01-01T00:00:00.000Z'),
        termEndDate: new Date('2031-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException)

    expect(await service.prisma.electedOffice.count()).toBe(1)
  })

  it('idempotently returns the existing office when the term start matches (crash-recovery retry)', async () => {
    const dispatch = vi.spyOn(
      service.app.get(MeetingBriefingsService),
      'onElectedOfficeCreated',
    )
    const first = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
    })

    const retry = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
    })

    expect(retry.id).toBe(first.id)
    expect(await service.prisma.electedOffice.count()).toBe(1)
    // The idempotent return path must still re-dispatch the schedule: a prior
    // call may have committed the row but died before dispatching.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id }),
    )
  })

  it('idempotently returns the existing office when no term dates are provided', async () => {
    const dispatch = vi.spyOn(
      service.app.get(MeetingBriefingsService),
      'onElectedOfficeCreated',
    )
    const first = await electedOffices.create({ userId: service.user.id })
    const again = await electedOffices.create({ userId: service.user.id })

    expect(again.id).toBe(first.id)
    expect(await service.prisma.electedOffice.count()).toBe(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id }),
    )
  })

  it('serializes concurrent creates into a single office', async () => {
    // Two simultaneous first-office submits for the same user. The advisory
    // lock + in-transaction recheck must collapse them to one office and one
    // organization — task 01 removed the unique constraint that used to
    // backstop this, so the lock is the only guard.
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
