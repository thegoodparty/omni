import { NotFoundException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useTestService } from '@/test-service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PersonMergesService } from '@/electionDb/personMerges/person-merges.service'
import { UserRole } from '../../generated/prisma'
import { PersonLookupService } from '../services/person-lookup.service'

const service = useTestService()

const PERSON_ID = '55555555-5555-4555-8555-555555555555'
const SURVIVOR_ID = '77777777-7777-4777-8777-777777777777'
const PROFILE_URL = 'https://goodparty.org/people/josh-santeramo-55555555'
const OPERATOR = 'ops@goodparty.org'

const LINKS = '/v1/person-profiles/links'

type Person = Awaited<ReturnType<PersonsService['getPersonById']>>

const promoteToAdmin = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

const createUser = (personId: string | null = null) =>
  service.prisma.user.create({
    data: {
      email: `link-${Date.now()}-${Math.random()}@test.goodparty.org`,
      personId,
    },
  })

const personIdOf = async (id: number) =>
  (await service.prisma.user.findUniqueOrThrow({ where: { id } })).personId

const link = (userId: number, personId = PERSON_ID) =>
  service.client.post(LINKS, { userId, personId, linkedBy: OPERATOR })

describe('/v1/person-profiles/links', () => {
  const spies: MockInstance[] = []

  // The election db sits behind three seams here: does the person exist, was
  // it retired, and what is its name. Each test pins all three so none of them
  // reaches whatever the harness has for that database.
  const stubPerson = (exists: boolean, retiredInto: string | null = null) => {
    const person = vi.spyOn(service.app.get(PersonsService), 'getPersonById')
    if (exists) person.mockResolvedValue({ id: PERSON_ID } as Person)
    else person.mockRejectedValue(new NotFoundException('Person not found'))

    const merge = vi.spyOn(
      service.app.get(PersonMergesService),
      'getPersonMerge',
    )
    if (retiredInto) {
      merge.mockImplementation(async (retiredId) => ({
        retiredId,
        survivingId: retiredInto,
        retiredSlug: null,
        retiredAt: new Date(),
        createdAt: new Date(),
      }))
    } else {
      merge.mockRejectedValue(new NotFoundException())
    }

    const identities = vi
      .spyOn(service.app.get(PersonLookupService), 'resolveIdentities')
      .mockResolvedValue(
        new Map([
          [PERSON_ID, { fullName: 'Josh Santeramo', profileUrl: PROFILE_URL }],
        ]),
      )
    spies.push(person, merge, identities)
    return person
  }

  // Restore only these spies: the harness authenticates the test client with
  // its own mocks, and a blanket restore logs every later request out.
  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore())
  })

  it('refuses a non-admin caller', async () => {
    const target = await createUser()
    stubPerson(true)

    const res = await link(target.id)

    expect(res.status).toBe(403)
    expect(await personIdOf(target.id)).toBeNull()
  })

  it('links an unlinked user so their editor unlocks', async () => {
    await promoteToAdmin()
    stubPerson(true)

    const res = await link(service.user.id)

    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      userId: service.user.id,
      personId: PERSON_ID,
      fullName: 'Josh Santeramo',
      profileUrl: PROFILE_URL,
      hasProfile: false,
    })
    expect(await personIdOf(service.user.id)).toBe(PERSON_ID)

    // The whole point: the editor gate reads exactly this link.
    const mine = await service.client.get('/v1/person-profiles/mine')
    expect(mine.data).toMatchObject({ profile: null, canCreate: true })
  })

  it('is a no-op when the user already holds that person', async () => {
    await promoteToAdmin()
    const target = await createUser(PERSON_ID)
    stubPerson(true)

    const res = await link(target.id)

    expect(res.status).toBe(200)
    expect(await personIdOf(target.id)).toBe(PERSON_ID)
  })

  // Moving a link has to carry the profile, takedown and claims with it,
  // which is the drift sweep's repoint, not this route.
  it('refuses to move a user who is linked to someone else', async () => {
    await promoteToAdmin()
    const other = '66666666-6666-4666-8666-666666666666'
    const target = await createUser(other)
    stubPerson(true)

    const res = await link(target.id)

    expect(res.status).toBe(409)
    expect(await personIdOf(target.id)).toBe(other)
  })

  it('refuses a person another user already holds', async () => {
    await promoteToAdmin()
    await createUser(PERSON_ID)
    const target = await createUser()
    stubPerson(true)

    const res = await link(target.id)

    expect(res.status).toBe(409)
    expect(await personIdOf(target.id)).toBeNull()
  })

  // A retired id reads as missing here, so this also keeps an operator from
  // parking someone on a purged duplicate whose page no longer renders.
  it('refuses a person the spine does not know', async () => {
    await promoteToAdmin()
    const target = await createUser()
    stubPerson(false)

    const res = await link(target.id)

    expect(res.status).toBe(404)
    expect(await personIdOf(target.id)).toBeNull()
  })

  // The operator gets the surviving id back, so they can link to it instead.
  it('refuses a retired person and names the survivor', async () => {
    await promoteToAdmin()
    const target = await createUser()
    stubPerson(false, SURVIVOR_ID)

    const res = await link(target.id)

    expect(res.status).toBe(400)
    expect(res.data.message).toContain(SURVIVOR_ID)
    expect(await personIdOf(target.id)).toBeNull()
  })

  it('reports an unlinked user as unlinked', async () => {
    await promoteToAdmin()
    const target = await createUser()
    stubPerson(true)

    const res = await service.client.get(LINKS, {
      params: { userId: target.id },
    })

    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      userId: target.id,
      personId: null,
      fullName: null,
      profileUrl: null,
      hasProfile: false,
    })
  })

  it('reports who a linked user is linked to', async () => {
    await promoteToAdmin()
    const target = await createUser(PERSON_ID)
    await service.prisma.personProfile.create({
      data: { personId: PERSON_ID, userId: target.id },
    })
    stubPerson(true)

    const res = await service.client.get(LINKS, {
      params: { userId: target.id },
    })

    expect(res.data).toEqual({
      userId: target.id,
      personId: PERSON_ID,
      fullName: 'Josh Santeramo',
      profileUrl: PROFILE_URL,
      hasProfile: true,
    })
  })

  it('refuses the link state to a non-admin caller', async () => {
    const target = await createUser()
    stubPerson(true)

    const res = await service.client.get(LINKS, {
      params: { userId: target.id },
    })

    expect(res.status).toBe(403)
  })

  it('404s an unknown user', async () => {
    await promoteToAdmin()
    stubPerson(true)

    const res = await link(999_999)

    expect(res.status).toBe(404)
  })
})
