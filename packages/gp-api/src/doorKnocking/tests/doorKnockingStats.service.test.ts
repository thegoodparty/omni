import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  ContactStatusField,
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  SupportAnswer,
  WillVoteAnswer,
} from '../../generated/prisma'
import { DoorKnockingStatsService } from '../services/doorKnockingStats.service'
import { DoorKnockingTurfService } from '../services/doorKnockingTurf.service'

const service = useTestService()

// Fixed instants rather than offsets from `now`, so an assertion about which
// answer is the LATEST one cannot become a race with the clock.
const T1 = new Date('2026-03-01T15:00:00.000Z')
const T2 = new Date('2026-03-02T15:00:00.000Z')
const T3 = new Date('2026-03-03T15:00:00.000Z')

describe('DoorKnockingStatsService', () => {
  let orgSlug: string
  let filterId: number
  let stats: DoorKnockingStatsService

  beforeEach(async () => {
    orgSlug = `dk-stats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'DK audience' },
    })
    filterId = filter.id
    stats = service.app.get(DoorKnockingStatsService)
  })

  // The services here are app singletons, so a spy on one outlives the test
  // that set it up and would silently arm the next.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // A whole 1:1:1 chain, written the way the create transaction writes one:
  // turf, route, stops with their targets, and the Outreach envelope that
  // carries the lifecycle. `doors` is one entry per stop, listing the
  // (personId, addressKey) pairs behind it — two entries sharing an address
  // key at one stop are the same DOOR with two residents.
  const seedTurf = async ({
    slug = orgSlug,
    voterFileFilterId = filterId,
    doors = [] as Array<Array<{ personId: string; addressKey: string }>>,
    completed = false,
    deleted = false,
  } = {}) => {
    const turf = await service.prisma.doorKnockingTurf.create({
      data: {
        voterFileFilterId,
        name: 'Elm St',
        color: '#22aa55',
        geoPoly: { type: 'Polygon', coordinates: [] },
        deletedAt: deleted ? new Date() : null,
      },
    })
    const route = await service.prisma.doorKnockingRoute.create({
      data: {
        doorKnockingTurfId: turf.id,
        mode: 'walk',
        loop: false,
        totalSeconds: 60,
        totalMeters: 100,
        credits: 1,
        stops: {
          create: doors.map((targets, index) => ({
            seq: index + 1,
            lat: 41.9 + index / 1000,
            lng: -87.65,
            displayAddress: `${index} W Elm St`,
            legSeconds: 1,
            legMeters: 1,
            targets: { create: targets },
          })),
        },
      },
    })
    await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.nativeDoorKnocking,
        status: completed
          ? OutreachStatus.completed
          : OutreachStatus.in_progress,
        doorKnockingRouteId: route.id,
      },
    })
    return { turfId: turf.id, routeId: route.id }
  }

  const knock = (
    personId: string,
    outcome: DoorKnockOutcome,
    {
      occurredAt = T1,
      supportAnswer = null as SupportAnswer | null,
      willVote = null as WillVoteAnswer | null,
      slug = orgSlug,
    } = {},
  ) =>
    service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: slug,
        personId,
        occurredAt,
        outcome,
        supportAnswer,
        willVote,
      },
    })

  describe('doorAttempts and lastCanvassActivityAt', () => {
    it('counts one attempt per interaction row and reports the newest', async () => {
      await knock('p1', DoorKnockOutcome.not_home, { occurredAt: T1 })
      await knock('p1', DoorKnockOutcome.not_home, { occurredAt: T2 })
      await knock('p2', DoorKnockOutcome.answered, { occurredAt: T3 })

      const totals = await stats.canvassingTotals(orgSlug)

      // Three rows, two people: attempts count the knocking, not the doors.
      expect(totals.doorAttempts).toBe(3)
      expect(totals.lastCanvassActivityAt).toEqual(T3)
    })

    it('reports zeroes and a null timestamp for an org that has never knocked', async () => {
      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals).toEqual({
        uniqueDoorsKnocked: 0,
        doorAttempts: 0,
        uniqueContactsMade: 0,
        totalContactsMade: 0,
        committedVoters: 0,
        votersPersuaded: 0,
        uniqueTurfsCreated: 0,
        uniqueTurfsCompleted: 0,
        lastCanvassActivityAt: null,
      })
    })

    it('never reads another org’s knocks', async () => {
      const otherSlug = `dk-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await knock('p1', DoorKnockOutcome.answered, { slug: otherSlug })

      expect((await stats.canvassingTotals(orgSlug)).doorAttempts).toBe(0)
    })
  })

  describe('uniqueDoorsKnocked', () => {
    it('counts a door once however many residents behind it were knocked', async () => {
      await seedTurf({
        doors: [
          [
            { personId: 'p1', addressKey: '12 ELM|3B|60601' },
            { personId: 'p2', addressKey: '12 ELM|3B|60601' },
          ],
        ],
      })
      await knock('p1', DoorKnockOutcome.answered, {
        supportAnswer: SupportAnswer.unsure,
      })
      await knock('p2', DoorKnockOutcome.not_home)

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(1)
    })

    it('counts two doors at one stop when the address keys differ', async () => {
      await seedTurf({
        doors: [
          [
            { personId: 'p1', addressKey: '12 ELM|3B|60601' },
            { personId: 'p2', addressKey: '12 ELM|3C|60601' },
          ],
        ],
      })
      await knock('p1', DoorKnockOutcome.answered)
      await knock('p2', DoorKnockOutcome.not_home)

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(2)
    })

    it('leaves out a door nobody knocked', async () => {
      await seedTurf({
        doors: [
          [{ personId: 'p1', addressKey: '12 ELM|3B|60601' }],
          [{ personId: 'p2', addressKey: '14 ELM||60601' }],
        ],
      })
      await knock('p1', DoorKnockOutcome.not_home)

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(1)
    })

    // The conversation a candidate most wants credit for. `deriveKnockStatus`
    // leaves this door grey and knockable, which is right for the map — there
    // is work left here — and wrong for a cumulative total, which asks what
    // was done. Counting it also keeps the event internally consistent: the
    // same knock is already in `doorAttempts` and both contacts-made numbers.
    it('counts a door where the conversation ended undecided', async () => {
      await seedTurf({
        doors: [[{ personId: 'p1', addressKey: '12 ELM|3B|60601' }]],
      })
      await knock('p1', DoorKnockOutcome.answered, {
        supportAnswer: SupportAnswer.unsure,
      })

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.uniqueDoorsKnocked).toBe(1)
      expect(totals.uniqueContactsMade).toBe(1)
    })

    // The one place this deliberately parts company with
    // DoorKnockingTurfCountsService, which counts a do-not-knock house as
    // DONE so a correctly-skipped door cannot hold a progress bar below 100%.
    // A door nobody went to is not a door that was knocked.
    it('does not count a door whose only resident was flagged do-not-knock', async () => {
      await seedTurf({
        doors: [[{ personId: 'p1', addressKey: '12 ELM|3B|60601' }]],
      })
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: 'p1',
          field: ContactStatusField.do_not_knock,
          value: 'active',
        },
      })

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(0)
    })

    // A status typed into the CRM is not a door anybody walked to.
    it('does not count a door known only from a manual support-status override', async () => {
      await seedTurf({
        doors: [[{ personId: 'p1', addressKey: '12 ELM|3B|60601' }]],
      })
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: 'p1',
          field: ContactStatusField.support_status,
          value: 'supporter',
        },
      })

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(0)
    })

    // The converse: an override cannot retract a visit that happened.
    it('keeps a knocked door when an override sets the resident back to unknown', async () => {
      await seedTurf({
        doors: [[{ personId: 'p1', addressKey: '12 ELM|3B|60601' }]],
      })
      await knock('p1', DoorKnockOutcome.refused_to_engage)
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: 'p1',
          field: ContactStatusField.support_status,
          value: 'unknown',
        },
      })

      expect((await stats.canvassingTotals(orgSlug)).uniqueDoorsKnocked).toBe(1)
    })

    // Both numbers now come from the same rows — every door counted here has
    // at least one attempt behind it — so a fixture that inverted them would
    // be reporting doors nobody knocked, which is the shape of the bug this
    // definition replaced.
    it('never reports more doors than attempts', async () => {
      await seedTurf({
        doors: [
          [{ personId: 'p1', addressKey: '12 ELM|3B|60601' }],
          [{ personId: 'p2', addressKey: '14 ELM||60601' }],
          [{ personId: 'p3', addressKey: '16 ELM||60601' }],
        ],
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.unsure,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        supportAnswer: SupportAnswer.supporter,
      })
      await knock('p2', DoorKnockOutcome.not_home, { occurredAt: T2 })

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.doorAttempts).toBe(3)
      expect(totals.uniqueDoorsKnocked).toBe(2)
      expect(totals.doorAttempts).toBeGreaterThanOrEqual(
        totals.uniqueDoorsKnocked,
      )
    })

    it('leaves out the doors of a tombstoned list', async () => {
      await seedTurf({
        deleted: true,
        doors: [[{ personId: 'p1', addressKey: '12 ELM|3B|60601' }]],
      })
      await knock('p1', DoorKnockOutcome.not_home)

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.uniqueDoorsKnocked).toBe(0)
      // The interaction outlives the list by design, so the attempt stays.
      expect(totals.doorAttempts).toBe(1)
    })
  })

  describe('contacts made', () => {
    it('counts answered and refused_to_engage, and nothing else', async () => {
      await knock('p1', DoorKnockOutcome.answered)
      await knock('p2', DoorKnockOutcome.refused_to_engage)
      await knock('p3', DoorKnockOutcome.not_home)
      await knock('p4', DoorKnockOutcome.inaccessible)
      await knock('p5', DoorKnockOutcome.not_a_voter)

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.totalContactsMade).toBe(2)
      expect(totals.uniqueContactsMade).toBe(2)
    })

    it('counts every conversation but each person once', async () => {
      await knock('p1', DoorKnockOutcome.answered, { occurredAt: T1 })
      await knock('p1', DoorKnockOutcome.answered, { occurredAt: T2 })
      await knock('p2', DoorKnockOutcome.refused_to_engage, { occurredAt: T2 })

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.totalContactsMade).toBe(3)
      expect(totals.uniqueContactsMade).toBe(2)
    })
  })

  describe('committedVoters', () => {
    it('counts a person whose latest answers are supporter and will-vote yes', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        supportAnswer: SupportAnswer.supporter,
        willVote: WillVoteAnswer.yes,
      })

      expect((await stats.canvassingTotals(orgSlug)).committedVoters).toBe(1)
    })

    it('takes the two answers from whichever visit gave each one', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.supporter,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        willVote: WillVoteAnswer.yes,
      })

      expect((await stats.canvassingTotals(orgSlug)).committedVoters).toBe(1)
    })

    it('drops a supporter who later says they will not vote', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.supporter,
        willVote: WillVoteAnswer.yes,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        willVote: WillVoteAnswer.no,
      })

      expect((await stats.canvassingTotals(orgSlug)).committedVoters).toBe(0)
    })

    it('needs both answers, not just support', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        supportAnswer: SupportAnswer.supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).committedVoters).toBe(0)
    })

    // Door-attributed on purpose: SupportStatusService's derivation unions
    // phone banking, and a phone-banked supporter is not canvassing work.
    it('ignores a support answer captured on the phone', async () => {
      await service.prisma.contactInteractionPhoneBanking.create({
        data: {
          organizationSlug: orgSlug,
          personId: 'p1',
          occurredAt: T1,
          outcome: 'answered',
          supportAnswer: SupportAnswer.supporter,
        },
      })
      await knock('p1', DoorKnockOutcome.answered, {
        willVote: WillVoteAnswer.yes,
      })

      expect((await stats.canvassingTotals(orgSlug)).committedVoters).toBe(0)
    })
  })

  describe('votersPersuaded', () => {
    it('counts a non_supporter who later answers supporter', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.non_supporter,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        supportAnswer: SupportAnswer.supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).votersPersuaded).toBe(1)
    })

    it('does not count the same two answers in the other order', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.supporter,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        supportAnswer: SupportAnswer.non_supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).votersPersuaded).toBe(0)
    })

    it('does not count a supporter who was never anything else', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        supportAnswer: SupportAnswer.supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).votersPersuaded).toBe(0)
    })

    // The transition is history: it happened, and a later change of heart does
    // not unhappen it.
    it('keeps counting someone who flips back afterwards', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.non_supporter,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T2,
        supportAnswer: SupportAnswer.supporter,
      })
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T3,
        supportAnswer: SupportAnswer.non_supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).votersPersuaded).toBe(1)
    })

    it('does not read one person’s earlier answer as another person’s', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: T1,
        supportAnswer: SupportAnswer.non_supporter,
      })
      await knock('p2', DoorKnockOutcome.answered, {
        occurredAt: T2,
        supportAnswer: SupportAnswer.supporter,
      })

      expect((await stats.canvassingTotals(orgSlug)).votersPersuaded).toBe(0)
    })
  })

  describe('turf counts', () => {
    it('counts live turfs and the completed subset of them', async () => {
      await seedTurf({ completed: true })
      await seedTurf()
      await seedTurf({ deleted: true })

      const totals = await stats.canvassingTotals(orgSlug)

      expect(totals.uniqueTurfsCreated).toBe(2)
      expect(totals.uniqueTurfsCompleted).toBe(1)
    })

    it('never reads another org’s turfs', async () => {
      const otherSlug = `dk-other-turf-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      const otherFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: otherSlug, name: 'Theirs' },
      })
      await seedTurf({ slug: otherSlug, voterFileFilterId: otherFilter.id })

      expect((await stats.canvassingTotals(orgSlug)).uniqueTurfsCreated).toBe(0)
    })
  })

  describe('the payload', () => {
    const trackSpy = () =>
      vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue(undefined as never)

    it('carries the user’s email and both HubSpot ids', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { hubspotId: 'contact-42' } },
      })
      const campaign = await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `dk-stats-campaign-${Date.now()}`,
          organizationSlug: orgSlug,
          data: { hubspotId: 'company-7' },
        },
      })
      const track = trackSpy()

      await stats.emitCanvassingTotals(service.user.id, orgSlug)

      expect(track).toHaveBeenCalledWith(
        service.user.id,
        EVENTS.DoorKnocking.CanvassingTotalsUpdated,
        expect.objectContaining({
          email: service.user.email,
          hubspotContactId: 'contact-42',
          hubspotCompanyId: 'company-7',
          organizationSlug: orgSlug,
          campaignId: campaign.id,
        }),
      )
    })

    // A Serve (`eo-`) org has no campaign row at all, so both campaign-derived
    // fields are absent rather than the event failing. Several of the metrics
    // are support-answer-derived and will read zero for Serve, which is a
    // product question rather than a bug here.
    it('sends nulls for a Serve org rather than failing', async () => {
      const track = trackSpy()

      await stats.emitCanvassingTotals(service.user.id, orgSlug)

      expect(track).toHaveBeenCalledWith(
        service.user.id,
        EVENTS.DoorKnocking.CanvassingTotalsUpdated,
        expect.objectContaining({
          hubspotCompanyId: null,
          campaignId: null,
        }),
      )
    })

    it('sends the timestamp as an ISO string HubSpot can parse', async () => {
      await knock('p1', DoorKnockOutcome.answered, { occurredAt: T2 })
      const track = trackSpy()

      await stats.emitCanvassingTotals(service.user.id, orgSlug)

      expect(track.mock.calls[0]?.[2]).toMatchObject({
        lastCanvassActivityAt: T2.toISOString(),
        doorAttempts: 1,
      })
    })
  })

  describe('the daily sweep', () => {
    const spyOnEmit = () =>
      vi.spyOn(stats, 'emitCanvassingTotals').mockResolvedValue(undefined)

    it('emits for an org that recorded a knock, attributed to its owner', async () => {
      await knock('p1', DoorKnockOutcome.answered)
      const emit = spyOnEmit()

      await stats.sweepCanvassingTotals()

      expect(emit).toHaveBeenCalledWith(service.user.id, orgSlug)
    })

    it('leaves alone an org whose knocks all landed before the window', async () => {
      const stale = await knock('p1', DoorKnockOutcome.answered)
      await service.prisma.contactInteractionDoorKnock.update({
        where: { id: stale.id },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      })
      const emit = spyOnEmit()

      await stats.sweepCanvassingTotals()

      expect(emit).not.toHaveBeenCalled()
    })

    // A backdated manual log still moves the totals, so the window is measured
    // on when the row landed rather than on when the knock happened.
    it('picks up a knock recorded today but dated last month', async () => {
      await knock('p1', DoorKnockOutcome.answered, {
        occurredAt: new Date('2026-01-15T00:00:00.000Z'),
      })
      const emit = spyOnEmit()

      await stats.sweepCanvassingTotals()

      expect(emit).toHaveBeenCalledWith(service.user.id, orgSlug)
    })

    // Two ECS replicas fire the same @Cron on the same instant; the daily
    // claim is what makes that one rollup per org rather than two.
    it('runs once a day however many replicas fire it', async () => {
      await knock('p1', DoorKnockOutcome.answered)
      const emit = spyOnEmit()

      await stats.sweepCanvassingTotals()
      await stats.sweepCanvassingTotals()

      expect(emit).toHaveBeenCalledTimes(1)
    })

    // The job fires one tick a day, so a claim left open outlives every
    // retry opportunity: the stale-takeover window closes long before the
    // next tick and the day's sweep is lost without anyone noticing.
    it('seals the daily lease even when selecting the active orgs throws', async () => {
      const completed = vi.spyOn(
        service.app.get(CronLockService),
        'markCompleted',
      )
      vi.spyOn(
        service.prisma.contactInteractionDoorKnock,
        'groupBy',
      ).mockRejectedValue(new Error('the database went away'))

      await expect(stats.sweepCanvassingTotals()).resolves.toBeUndefined()

      expect(completed).toHaveBeenCalled()
    })

    it('keeps going when one org fails', async () => {
      const otherSlug = `dk-sweep-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await knock('p1', DoorKnockOutcome.answered)
      await knock('p2', DoorKnockOutcome.answered, { slug: otherSlug })
      const emit = vi
        .spyOn(stats, 'emitCanvassingTotals')
        .mockRejectedValueOnce(new Error('segment is down'))
        .mockResolvedValue(undefined)

      await stats.sweepCanvassingTotals()

      expect(emit).toHaveBeenCalledTimes(2)
    })
  })

  // A tombstone moves the turf-derived totals down, and HubSpot SETs rather
  // than accumulates, so a delete that is never followed by other activity
  // would otherwise leave the company holding the pre-delete numbers.
  describe('firing from turf delete', () => {
    it('emits so the lowered totals reach HubSpot', async () => {
      const { turfId } = await seedTurf()
      const emit = vi
        .spyOn(stats, 'emitCanvassingTotals')
        .mockResolvedValue(undefined)
      const turfs = service.app.get(DoorKnockingTurfService)

      await turfs.delete(turfId, orgSlug, service.user.id)

      expect(emit).toHaveBeenCalledWith(service.user.id, orgSlug)
      expect((await stats.canvassingTotals(orgSlug)).uniqueTurfsCreated).toBe(0)
    })
  })

  describe('firing from turf complete', () => {
    it('emits once, and not again on a repeat press', async () => {
      const { turfId } = await seedTurf()
      const emit = vi
        .spyOn(stats, 'emitCanvassingTotals')
        .mockResolvedValue(undefined)
      const turfs = service.app.get(DoorKnockingTurfService)

      await turfs.complete(turfId, orgSlug, service.user.id, undefined)
      await turfs.complete(turfId, orgSlug, service.user.id, undefined)

      // The second call returns early on the idempotence guard, so the event
      // is behind it: a stray tap on a finished list must not teach HubSpot
      // that the list was completed twice.
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith(service.user.id, orgSlug)
    })
  })
})
