import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { PersonIdBackfillService } from './person-id-backfill.service'
import { MarketingRevalidationService } from './marketing-revalidation.service'

const service = useTestService()

// Civics person ids (UUIDs). OLD is what gp-api has stored; NEW is what the
// data platform re-resolves the same human to after a candidacy merge.
const OLD = '33333333-3333-3333-3333-333333333333'
const NEW = '44444444-4444-4444-4444-444444444444'
const OPERATOR = 'ops@goodparty.org'

const backfill = () => service.app.get(PersonIdBackfillService)

const spyElections = (result: string | null) =>
  vi
    .spyOn(service.app.get(ElectionsService), 'getPersonIdByGpApiUserId')
    .mockResolvedValue(result)

const spyRevalidate = () =>
  vi
    .spyOn(service.app.get(MarketingRevalidationService), 'revalidatePerson')
    .mockResolvedValue(undefined)

const getUser = (id: number) =>
  service.prisma.user.findUniqueOrThrow({ where: { id } })

// Always re-read the user first: the service takes the row as its input, and
// every test mutates the link before calling it.
const resync = async () =>
  backfill().resyncLinkedUser(await getUser(service.user.id))

const linkUser = (personId: string | null) =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { personId },
  })

const seedProfile = (personId: string, userId = service.user.id) =>
  service.prisma.personProfile.create({ data: { personId, userId } })

const seedRemoval = (personId: string) =>
  service.prisma.personProfileRemoval.create({
    data: { personId, appliedBy: OPERATOR },
  })

const seedClaimRequest = (personId: string) =>
  service.prisma.profileClaimRequest.create({
    data: { personId, requesterEmail: `notify-${Date.now()}@example.com` },
  })

const profilePersonId = async (userId: number) =>
  (await service.prisma.personProfile.findUnique({ where: { userId } }))
    ?.personId

const removalPersonIds = async () =>
  (
    await service.prisma.personProfileRemoval.findMany({
      where: { personId: { in: [OLD, NEW] } },
      select: { personId: true },
    })
  ).map((r) => r.personId)

const claimRequestPersonIds = async () =>
  (
    await service.prisma.profileClaimRequest.findMany({
      where: { personId: { in: [OLD, NEW] } },
      select: { personId: true },
    })
  ).map((r) => r.personId)

describe('PersonIdBackfillService.resyncLinkedUser', () => {
  beforeEach(() => linkUser(OLD))
  afterEach(() => vi.restoreAllMocks())

  it('leaves a link that still matches the spine alone', async () => {
    spyElections(OLD)
    const revalidate = spyRevalidate()

    expect(await resync()).toBe('unchanged')

    expect((await getUser(service.user.id)).personId).toBe(OLD)
    // An unchanged link must not churn the marketing cache on every sweep.
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('carries the profile, takedown and claim requests to the surviving id', async () => {
    await seedProfile(OLD)
    await seedRemoval(OLD)
    await seedClaimRequest(OLD)
    spyElections(NEW)
    spyRevalidate()

    expect(await resync()).toBe('repointed')

    expect((await getUser(service.user.id)).personId).toBe(NEW)
    expect(await profilePersonId(service.user.id)).toBe(NEW)
    expect(await removalPersonIds()).toEqual([NEW])
    expect(await claimRequestPersonIds()).toEqual([NEW])
  })

  it('busts the cache for both the retired and the surviving page', async () => {
    await seedProfile(OLD)
    spyElections(NEW)
    const revalidate = spyRevalidate()

    await resync()

    // The old slug has to stop serving this person's overlay just as much as
    // the new one has to start.
    expect(revalidate).toHaveBeenCalledWith(OLD)
    expect(revalidate).toHaveBeenCalledWith(NEW)
  })

  it('repoints a user who has only a takedown and no profile', async () => {
    await seedRemoval(OLD)
    spyElections(NEW)
    spyRevalidate()

    expect(await resync()).toBe('repointed')

    // The takedown is the whole point: left on the retired id it silently stops
    // being honored once the person renders under the surviving one.
    expect(await removalPersonIds()).toEqual([NEW])
  })

  // getPersonIdByGpApiUserId swallows its own errors and returns null, so null
  // means "no link OR election-api is down". Unlinking on it would tear down
  // the entire cohort the first time the upstream has a bad minute.
  it('leaves the link alone when the spine returns nothing', async () => {
    await seedProfile(OLD)
    spyElections(null)
    const revalidate = spyRevalidate()

    expect(await resync()).toBe('unresolved')

    expect((await getUser(service.user.id)).personId).toBe(OLD)
    expect(await profilePersonId(service.user.id)).toBe(OLD)
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('does not call the spine for a user who was never linked', async () => {
    await linkUser(null)
    const spy = spyElections(NEW)

    expect(await resync()).toBe('unchanged')

    // Linking the unlinked is linkUserIfMissing's job, not this one's.
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('PersonIdBackfillService.resyncLinkedUser collisions', () => {
  beforeEach(() => linkUser(OLD))
  afterEach(() => vi.restoreAllMocks())

  it('refuses the move when another user already owns the surviving id', async () => {
    await seedProfile(OLD)
    await service.prisma.user.create({
      data: { email: `rival-${Date.now()}@test.goodparty.org`, personId: NEW },
    })
    spyElections(NEW)

    expect(await resync()).toBe('collision')

    expect((await getUser(service.user.id)).personId).toBe(OLD)
    expect(await profilePersonId(service.user.id)).toBe(OLD)
  })

  it('refuses the move rather than collapsing two takedown records', async () => {
    await seedRemoval(OLD)
    await seedRemoval(NEW)
    spyElections(NEW)

    expect(await resync()).toBe('collision')

    // Each row carries its own actor, note and cleared state; picking a winner
    // silently discards an audit record we may have to produce later.
    expect((await removalPersonIds()).sort()).toEqual([OLD, NEW].sort())
    // The takedown is the last row the repoint touches, so a non-atomic version
    // would already have moved the link before hitting the conflict.
    expect((await getUser(service.user.id)).personId).toBe(OLD)
  })

  it('applies nothing at all when one table blocks', async () => {
    await seedProfile(OLD)
    await seedRemoval(OLD)
    await seedClaimRequest(OLD)
    await seedRemoval(NEW)
    spyElections(NEW)

    expect(await resync()).toBe('collision')

    // A half-repointed user reads as healthy while behaving as broken, so the
    // blocked move has to roll back the rows that could have moved.
    expect((await getUser(service.user.id)).personId).toBe(OLD)
    expect(await profilePersonId(service.user.id)).toBe(OLD)
    expect(await claimRequestPersonIds()).toEqual([OLD])
  })
})

describe('PersonIdBackfillService.reconcileDriftedPersonIds', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sweeps a linked profile owner', async () => {
    await linkUser(OLD)
    await seedProfile(OLD)
    spyElections(NEW)
    spyRevalidate()

    const result = await backfill().reconcileDriftedPersonIds(50)

    expect(result.repointed).toBe(1)
    expect((await getUser(service.user.id)).personId).toBe(NEW)
  })

  it('skips a linked user with no profile and no takedown', async () => {
    await linkUser(OLD)
    const spy = spyElections(NEW)

    const result = await backfill().reconcileDriftedPersonIds(50)

    // Nothing of theirs is on the public site yet, so a stale link costs
    // nothing until they create something — and checking every linked user
    // would put the whole table on election-api's doorstep nightly.
    expect(result.scanned).toBe(0)
    expect(spy).not.toHaveBeenCalled()
    expect((await getUser(service.user.id)).personId).toBe(OLD)
  })

  it('reports a collision without aborting the pass', async () => {
    await linkUser(OLD)
    await seedProfile(OLD)
    await seedRemoval(OLD)
    await seedRemoval(NEW)
    spyElections(NEW)

    const result = await backfill().reconcileDriftedPersonIds(50)

    expect(result).toMatchObject({ repointed: 0, collisions: 1 })
  })
})
