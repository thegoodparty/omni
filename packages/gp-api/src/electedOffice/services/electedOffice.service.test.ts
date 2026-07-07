import { useTestService } from '@/test-service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { OrdinanceDispatchService } from '@/ordinances/services/ordinanceDispatch.service'
import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dateRangesOverlap,
  ElectedOfficeService,
} from './electedOffice.service'

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

    expect(office.termStartDate).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(office.termEndDate).toEqual(new Date('2029-01-01T00:00:00.000Z'))

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

  it('leaves term fields null when no term dates are provided', async () => {
    const office = await electedOffices.create({ userId: service.user.id })

    expect(office.termStartDate).toBeNull()
    expect(office.termEndDate).toBeNull()
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

  it('allows a second office whose term starts exactly when the prior term ends (half-open boundary)', async () => {
    await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2020-01-01T00:00:00.000Z'),
      termEndDate: new Date('2024-01-01T00:00:00.000Z'),
    })

    const second = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2024-01-01T00:00:00.000Z'),
      termEndDate: new Date('2028-01-01T00:00:00.000Z'),
    })

    expect(await service.prisma.electedOffice.count()).toBe(2)
    expect(second.termStartDate).toEqual(new Date('2024-01-01T00:00:00.000Z'))
  })

  it('rejects a same-start retry whose end date differs (term correction must not silently no-op)', async () => {
    await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
    })

    await expect(
      electedOffices.create({
        userId: service.user.id,
        termStartDate: new Date('2025-01-01T00:00:00.000Z'),
        termEndDate: new Date('2027-01-01T00:00:00.000Z'),
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

  it('fills a term-less placeholder when a later prefill supplies term dates and position', async () => {
    // A bare magic link (no BallotReady person) provisions a term-less
    // placeholder. A later re-send with a person id calls create() again with
    // term dates + org data — it must fill the same placeholder, not drop the
    // prefill or insert a duplicate.
    const placeholder = await electedOffices.create({ userId: service.user.id })
    expect(placeholder.termStartDate).toBeNull()

    const filled = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2029-01-01T00:00:00.000Z'),
      orgData: {
        positionId: 'br-pos-9',
        customPositionName: 'Mayor',
        overrideDistrictId: null,
      },
    })

    expect(filled.id).toBe(placeholder.id)
    expect(filled.termStartDate).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(filled.termEndDate).toEqual(new Date('2029-01-01T00:00:00.000Z'))
    expect(await service.prisma.electedOffice.count()).toBe(1)

    const org = await service.prisma.organization.findUnique({
      where: { slug: filled.organizationSlug },
    })
    expect(org).toMatchObject({
      positionId: 'br-pos-9',
      customPositionName: 'Mayor',
    })
  })

  it('does not 409 a later dated term against a partial prefill with only an end date', async () => {
    // A BallotReady prefill can return a holder with startAt: null but a real
    // endAt, producing a (termStartDate: null, termEndDate: <date>) row that the
    // term-less placeholder finder does NOT adopt. A magic-link retry that later
    // brings a fully-dated term whose start falls before that end must not be
    // treated as overlapping (the existing row's start is unknown, not -Infinity).
    await service.prisma.organization.create({
      data: { slug: 'eo-partial-prefill', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: 'eo-partial-prefill',
        termStartDate: null,
        termEndDate: new Date('2029-01-01T00:00:00.000Z'),
      },
    })

    const dated = await electedOffices.create({
      userId: service.user.id,
      termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      termEndDate: new Date('2028-01-01T00:00:00.000Z'),
    })

    expect(dated.termStartDate).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(await service.prisma.electedOffice.count()).toBe(2)
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

  it('dispatches ordinance sourcing after creating an office', async () => {
    const dispatch = vi
      .spyOn(
        service.app.get(OrdinanceDispatchService),
        'onElectedOfficeCreated',
      )
      .mockResolvedValue(undefined)

    const office = await electedOffices.create({ userId: service.user.id })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: office.id }),
    )
  })

  it('still creates the office when the ordinance dispatch rejects', async () => {
    // dispatchRun throws BadGatewayException in preview envs (no queue); the
    // hook must swallow it so EO creation never 500s on a dispatch failure.
    vi.spyOn(
      service.app.get(OrdinanceDispatchService),
      'onElectedOfficeCreated',
    ).mockRejectedValue(new Error('dispatch failed'))

    const office = await electedOffices.create({ userId: service.user.id })

    expect(office.id).toBeDefined()
    expect(await service.prisma.electedOffice.count()).toBe(1)
  })

  it('returns without waiting for the ordinance dispatch to settle', async () => {
    vi.spyOn(
      service.app.get(OrdinanceDispatchService),
      'onElectedOfficeCreated',
    ).mockReturnValue(new Promise<void>(() => undefined))

    const office = await electedOffices.create({ userId: service.user.id })

    expect(office.id).toBeDefined()
  }, 3000)
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

describe('dateRangesOverlap', () => {
  const d = (s: string) => new Date(s)

  it('detects overlapping dated terms', () => {
    expect(
      dateRangesOverlap(
        d('2025-01-01'),
        d('2029-01-01'),
        d('2028-01-01'),
        d('2030-01-01'),
      ),
    ).toBe(true)
  })

  it('treats half-open consecutive terms (A.end === B.start) as non-overlapping', () => {
    expect(
      dateRangesOverlap(
        d('2021-01-01'),
        d('2025-01-01'),
        d('2025-01-01'),
        d('2029-01-01'),
      ),
    ).toBe(false)
  })

  it('treats an all-null range as non-comparable (no overlap)', () => {
    expect(
      dateRangesOverlap(null, null, d('2025-01-01'), d('2029-01-01')),
    ).toBe(false)
  })

  it('treats a null START with a real end as non-comparable (no spurious 409 on partial prefill)', () => {
    // The (null, end) partial-prefill row must not 409 a later dated term whose
    // start precedes that end — its start is unknown, not -Infinity.
    expect(
      dateRangesOverlap(
        null,
        d('2029-01-01'),
        d('2025-01-01'),
        d('2028-01-01'),
      ),
    ).toBe(false)
    expect(
      dateRangesOverlap(
        d('2025-01-01'),
        d('2028-01-01'),
        null,
        d('2029-01-01'),
      ),
    ).toBe(false)
  })

  it('still treats a null END with a real start as an indefinite (+Infinity) term that overlaps', () => {
    expect(
      dateRangesOverlap(
        d('2020-01-01'),
        null,
        d('2025-01-01'),
        d('2029-01-01'),
      ),
    ).toBe(true)
  })
})
