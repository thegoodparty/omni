import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'
import { UserRole } from '../../generated/prisma'

const service = useTestService()

const ACTIVE_PERSON_ID = '33333333-3333-4333-8333-333333333333'
const CLEARED_PERSON_ID = '44444444-4444-4444-8444-444444444444'

const REMOVALS = '/v1/person-profiles/removals'

const OPERATOR = 'ops@goodparty.org'

const promoteToAdmin = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

const seedRemoval = (
  personId: string,
  overrides: { note?: string; clearedAt?: Date } = {},
) =>
  service.prisma.personProfileRemoval.create({
    data: {
      personId,
      appliedBy: OPERATOR,
      note: overrides.note ?? null,
      clearedAt: overrides.clearedAt ?? null,
      clearedBy: overrides.clearedAt ? OPERATOR : null,
    },
  })

const list = (params?: { includeCleared: boolean }) =>
  service.client.get(REMOVALS, { params })

describe('GET /v1/person-profiles/removals', () => {
  it('refuses a non-admin caller', async () => {
    // This is the only removal shape carrying the ops note, which is free text
    // an operator typed about a privacy request and can quote the subject.
    await seedRemoval(ACTIVE_PERSON_ID, { note: 'court order re: J. Rivera' })

    const res = await list()

    expect(res.status).toBe(403)
  })

  it('returns the actor and note for an active takedown', async () => {
    await promoteToAdmin()
    await seedRemoval(ACTIVE_PERSON_ID, { note: 'CA privacy request' })

    const res = await list()

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({
      personId: ACTIVE_PERSON_ID,
      note: 'CA privacy request',
      appliedBy: OPERATOR,
      clearedAt: null,
      clearedBy: null,
    })
  })

  it('hides reverted takedowns unless they are asked for', async () => {
    await promoteToAdmin()
    await seedRemoval(ACTIVE_PERSON_ID)
    await seedRemoval(CLEARED_PERSON_ID, { clearedAt: new Date() })

    const active = await list()
    expect(active.status).toBe(200)
    expect(active.data).toHaveLength(1)
    expect(active.data[0].personId).toBe(ACTIVE_PERSON_ID)

    const all = await list({ includeCleared: true })
    expect(all.status).toBe(200)
    expect(all.data).toHaveLength(2)
  })

  it('sorts active takedowns ahead of reverted ones', async () => {
    await promoteToAdmin()
    // Seed the cleared row first so recency alone would put the active one
    // last: Postgres sorts NULLs last on ASC, which would bury exactly the
    // rows an operator opens this screen to act on.
    await seedRemoval(CLEARED_PERSON_ID, { clearedAt: new Date() })
    await seedRemoval(ACTIVE_PERSON_ID)

    const res = await list({ includeCleared: true })

    expect(res.status).toBe(200)
    expect(res.data.map((row: { personId: string }) => row.personId)).toEqual([
      ACTIVE_PERSON_ID,
      CLEARED_PERSON_ID,
    ])
  })

  it('records who reverted a takedown', async () => {
    await promoteToAdmin()
    await seedRemoval(ACTIVE_PERSON_ID)

    const cleared = await service.client.delete(REMOVALS, {
      data: { personId: ACTIVE_PERSON_ID, clearedBy: 'privacy@goodparty.org' },
    })
    expect(cleared.status).toBe(200)

    const res = await list({ includeCleared: true })

    expect(res.data).toHaveLength(1)
    expect(res.data[0].clearedBy).toBe('privacy@goodparty.org')
    expect(res.data[0].clearedAt).not.toBeNull()
    // The revert preserves who applied it — losing that would defeat the
    // paper trail this table exists to keep.
    expect(res.data[0].appliedBy).toBe(OPERATOR)
  })

  it('rejects a write that names no operator', async () => {
    await promoteToAdmin()

    const res = await service.client.post(REMOVALS, {
      personId: ACTIVE_PERSON_ID,
    })

    expect(res.status).toBe(400)
    expect(
      await service.prisma.personProfileRemoval.count({
        where: { personId: ACTIVE_PERSON_ID },
      }),
    ).toBe(0)
  })

  it('is idempotent when a clear is double-submitted', async () => {
    await promoteToAdmin()
    await seedRemoval(ACTIVE_PERSON_ID)

    const body = { personId: ACTIVE_PERSON_ID, clearedBy: OPERATOR }
    const first = await service.client.delete(REMOVALS, { data: body })
    const second = await service.client.delete(REMOVALS, { data: body })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const res = await list({ includeCleared: true })
    expect(res.data).toHaveLength(1)
  })
})
