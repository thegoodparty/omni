import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { PersonIdBackfillService } from './person-id-backfill.service'

const service = useTestService()

// Civics person id (UUID). Distinct from the gp-api User.id, which is numeric.
const PERSON_ID = '22222222-2222-2222-2222-222222222222'

const backfill = () => service.app.get(PersonIdBackfillService)

const spyElections = (result: string | null) =>
  vi
    .spyOn(service.app.get(ElectionsService), 'getPersonIdByGpApiUserId')
    .mockResolvedValue(result)

const getUser = (id: number) =>
  service.prisma.user.findUniqueOrThrow({ where: { id } })

const setPersonId = (personId: string | null) =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { personId },
  })

describe('PersonIdBackfillService.linkUserIfMissing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the existing personId without calling election-api', async () => {
    await setPersonId(PERSON_ID)
    const user = await getUser(service.user.id)
    const spy = spyElections('should-not-be-used')

    const result = await backfill().linkUserIfMissing(user)

    expect(result).toBe(PERSON_ID)
    expect(spy).not.toHaveBeenCalled()
  })

  it('pulls the link and writes User.person_id when it is missing', async () => {
    const user = await getUser(service.user.id)
    expect(user.personId).toBeNull()
    const spy = spyElections(PERSON_ID)

    const result = await backfill().linkUserIfMissing(user)

    expect(result).toBe(PERSON_ID)
    expect(spy).toHaveBeenCalledWith(service.user.id)
    // gp-api owns the write to its own DB.
    expect((await getUser(service.user.id)).personId).toBe(PERSON_ID)
  })

  it('returns null and writes nothing when election-api has no link', async () => {
    const user = await getUser(service.user.id)
    spyElections(null)

    const result = await backfill().linkUserIfMissing(user)

    expect(result).toBeNull()
    expect((await getUser(service.user.id)).personId).toBeNull()
  })

  it('swallows a unique-constraint clash and leaves this user unlinked', async () => {
    // Another user already owns the personId — the @unique write will P2002.
    const other = await service.prisma.user.create({
      data: {
        email: `owner-${Date.now()}@test.goodparty.org`,
        personId: PERSON_ID,
      },
    })
    const user = await getUser(service.user.id)
    spyElections(PERSON_ID)

    const result = await backfill().linkUserIfMissing(user)

    // Never throws, and the clash leaves this user unlinked: we return the
    // user's actual (null) personId, NOT the resolved id — otherwise canCreate
    // would unlock while POST still 409s.
    expect(result).toBeNull()
    expect((await getUser(service.user.id)).personId).toBeNull()
    expect((await getUser(other.id)).personId).toBe(PERSON_ID)
  })
})

describe('PersonIdBackfillService.reconcileNullPersonIds', () => {
  afterEach(() => vi.restoreAllMocks())

  it('links only scoped (campaign/elected-office) users with a null personId', async () => {
    // Scope service.user in via a Serve elected-office record.
    const org = await service.prisma.organization.create({
      data: { slug: `reconcile-${Date.now()}`, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: org.slug },
    })
    // A user with no campaign/office is out of scope and must be left alone.
    const unscoped = await service.prisma.user.create({
      data: { email: `unscoped-${Date.now()}@test.goodparty.org` },
    })
    const spy = spyElections(PERSON_ID)

    const result = await backfill().reconcileNullPersonIds(50)

    expect(result.linked).toBeGreaterThanOrEqual(1)
    expect(spy).toHaveBeenCalledWith(service.user.id)
    expect(spy).not.toHaveBeenCalledWith(unscoped.id)
    expect((await getUser(service.user.id)).personId).toBe(PERSON_ID)
    expect((await getUser(unscoped.id)).personId).toBeNull()
  })
})
