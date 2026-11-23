import { HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorKnockingStatsService } from '@/doorKnocking/services/doorKnockingStats.service'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { UserRole } from '../../generated/prisma'

const service = useTestService({ jobs: true })

const LIST_PATH = '/v1/admin/job-dead-letters'
const SOURCE_QUEUE = 'doorKnockingCanvassingTotals'
const DEAD_LETTER_QUEUE = `${SOURCE_QUEUE}-dlq`

// A real job through the real queue, failing at its dependency, so pg-boss
// dead-letters it with the provenance it records on its own (src/jobs/AGENTS.md
// § Tests). Resolves to the organization the job carried.
const deadLetterOne = async (group?: string): Promise<string> => {
  const organizationSlug = `dlq-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: service.user.id },
  })
  const stats = service.app.get(DoorKnockingStatsService)
  vi.spyOn(stats, 'emitCanvassingTotals').mockRejectedValue(
    new Error('Segment is down'),
  )
  await service.app
    .get(JobsService)
    .send(SOURCE_QUEUE, { organizationSlug }, { group })
  await service.jobs.settle({ allowDeadLetters: true })
  return organizationSlug
}

const listDeadLetters = (params?: Record<string, string>) =>
  service.client.get(LIST_PATH, { params })

const getDeadLetter = (id: string) => service.client.get(`${LIST_PATH}/${id}`)

const queuedJobsFor = async (organizationSlug: string) => {
  const rows = await service.prisma.$queryRaw<
    Array<{
      name: string
      state: string
      retry_count: number
      data: { organizationSlug: string }
    }>
  >`SELECT name, state::text, retry_count, data FROM pgboss.job
    WHERE name = ${SOURCE_QUEUE} AND state IN ('created', 'retry', 'active')
    ORDER BY created_on`
  return rows
    .filter((row) => row.data.organizationSlug === organizationSlug)
    .map((row) => ({
      name: row.name,
      state: row.state,
      retryCount: row.retry_count,
      data: row.data,
    }))
}

describe('admin job dead letters', () => {
  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
  })

  it('rejects a user who is not an admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await listDeadLetters()

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('lists a dead letter with the queue its job failed on', async () => {
    const organizationSlug = await deadLetterOne()

    const res = await listDeadLetters()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.meta).toEqual({ total: 1, offset: 0, limit: 100 })
    expect(res.data.data).toEqual([
      {
        id: expect.any(String),
        sourceQueue: SOURCE_QUEUE,
        createdAt: expect.any(String),
        retriesUsed: 2,
        data: { organizationSlug },
        error: 'Segment is down',
      },
    ])
  })

  it('filters the list by the queue the job failed on', async () => {
    await deadLetterOne()

    const matching = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const other = await listDeadLetters({ sourceQueue: 'contactUploadProcess' })

    expect(matching.data.meta.total).toBe(1)
    expect(other.data).toEqual({
      data: [],
      meta: { total: 0, offset: 0, limit: 100 },
    })
  })

  it('lists the distinct queues dead letters failed on', async () => {
    await deadLetterOne()
    await deadLetterOne()

    const response = await service.client.get(`${LIST_PATH}/queues`)

    expect(response.status).toBe(HttpStatus.OK)
    expect(response.data).toEqual([SOURCE_QUEUE])
  })

  it('rejects a non-admin listing the queues', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })

    const response = await service.client.get(`${LIST_PATH}/queues`)

    expect(response.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('reads one dead letter with the same shape the list gives it', async () => {
    const organizationSlug = await deadLetterOne()
    const listed = await listDeadLetters()
    const deadLetter: { id: string } = listed.data.data[0]

    const res = await getDeadLetter(deadLetter.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      id: deadLetter.id,
      sourceQueue: SOURCE_QUEUE,
      createdAt: expect.any(String),
      retriesUsed: 2,
      data: { organizationSlug },
      error: 'Segment is down',
    })
  })

  it('answers an unknown id with 404', async () => {
    const res = await getDeadLetter(randomUUID())

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('rejects a non-admin reading one dead letter', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await getDeadLetter(randomUUID())

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('redrives one dead letter onto the queue its job failed on', async () => {
    const organizationSlug = await deadLetterOne()
    const listed = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const deadLetter: { id: string } = listed.data.data[0]

    const res = await service.client.post(
      `${LIST_PATH}/${deadLetter.id}/redrive`,
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ id: deadLetter.id, sourceQueue: SOURCE_QUEUE })
    expect((await listDeadLetters()).data.meta.total).toBe(0)
    const requeued = await queuedJobsFor(organizationSlug)
    expect(requeued).toEqual([
      {
        name: SOURCE_QUEUE,
        state: 'created',
        retryCount: 0,
        data: { organizationSlug },
      },
    ])

    // pg-boss holds the rest of the group until it deletes the failed row,
    // about two minutes after the dead letter (src/jobs/AGENTS.md §
    // Ordering). Drop it here and the redriven job is what the worker runs,
    // with its attempts reset.
    await service.prisma.$executeRaw`
      DELETE FROM pgboss.job
      WHERE name = ${SOURCE_QUEUE} AND state = 'failed'`
    const stats = service.app.get(DoorKnockingStatsService)
    vi.mocked(stats.emitCanvassingTotals).mockResolvedValue(undefined)
    expect(await service.jobs.settle()).toEqual({ deadLetters: [] })
    expect(stats.emitCanvassingTotals).toHaveBeenLastCalledWith(
      service.user.id,
      organizationSlug,
    )
  })

  it('deletes one dead letter without requeueing it', async () => {
    const organizationSlug = await deadLetterOne()
    const listed = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const deadLetter: { id: string } = listed.data.data[0]

    const res = await service.client.delete(`${LIST_PATH}/${deadLetter.id}`)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ id: deadLetter.id })
    expect((await listDeadLetters()).data.meta.total).toBe(0)
    expect(await queuedJobsFor(organizationSlug)).toHaveLength(0)
    expect(
      (await service.client.delete(`${LIST_PATH}/${deadLetter.id}`)).status,
    ).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses to redrive a dead letter twice', async () => {
    const organizationSlug = await deadLetterOne()
    const listed = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const deadLetter: { id: string } = listed.data.data[0]

    const first = await service.client.post(
      `${LIST_PATH}/${deadLetter.id}/redrive`,
    )
    const second = await service.client.post(
      `${LIST_PATH}/${deadLetter.id}/redrive`,
    )

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.NOT_FOUND)
    expect(await queuedJobsFor(organizationSlug)).toHaveLength(1)
  })

  it('refuses a dead letter that records no source queue', async () => {
    const [inserted] = await service.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO pgboss.job (name, data, source_output)
      VALUES (${DEAD_LETTER_QUEUE}, '{}'::jsonb,
        '{"message":"failed before provenance"}'::jsonb)
      RETURNING id::text AS id`
    const id = inserted?.id

    const res = await service.client.post(`${LIST_PATH}/${id}/redrive`)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(res.data.message).toContain('records no source queue')
    expect(
      await service.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pgboss.job
        WHERE name = ${SOURCE_QUEUE}`,
    ).toEqual([{ count: 0 }])
  })

  it('answers 409 and keeps the dead letter when the source queue is gone', async () => {
    await deadLetterOne()
    const listedBefore = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const id: string = listedBefore.data.data[0].id
    await service.prisma.$executeRaw`
      UPDATE pgboss.job SET source_name = 'goneQueue'
      WHERE id = ${id}::uuid`

    const res = await service.client.post(`${LIST_PATH}/${id}/redrive`)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(res.data.message).toContain('no longer exists')
    expect((await listDeadLetters()).data.meta.total).toBe(1)
  })

  it('answers 409 and keeps the dead letter while its key is held', async () => {
    const group = `dlq-group-${randomUUID()}`
    const organizationSlug = await deadLetterOne(group)
    const listed = await listDeadLetters({ sourceQueue: SOURCE_QUEUE })
    const deadLetter: { id: string } = listed.data.data[0]
    await service.prisma.$executeRaw`
      UPDATE pgboss.job SET policy = 'key_strict_fifo'
      WHERE id = ${deadLetter.id}::uuid`
    await service.prisma.$executeRaw`
      INSERT INTO pgboss.job (id, name, data, state, policy, singleton_key)
      SELECT gen_random_uuid(), name, data, 'failed', policy, singleton_key
      FROM pgboss.job WHERE id = ${deadLetter.id}::uuid`
    const before = await queuedJobsFor(organizationSlug)

    const res = await service.client.post(
      `${LIST_PATH}/${deadLetter.id}/redrive`,
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect((await getDeadLetter(deadLetter.id)).status).toBe(HttpStatus.OK)
    expect(await queuedJobsFor(organizationSlug)).toEqual(before)
  })

  it('answers an unknown id with 404', async () => {
    const res = await service.client.post(
      `${LIST_PATH}/${randomUUID()}/redrive`,
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
