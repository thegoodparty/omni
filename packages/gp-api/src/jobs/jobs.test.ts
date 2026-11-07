import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { useTestService } from '@/test-service'
import { JobsService } from './jobs.service'

const service = useTestService()

const queuedUploadIds = async (): Promise<string[]> => {
  const rows = await service.prisma.$queryRaw<
    Array<{ upload_id: string }>
  >`SELECT data->>'uploadId' AS upload_id FROM pgboss.job
    WHERE name = 'contactUploadProcess'`
  return rows.map((row) => row.upload_id)
}

describe('JobsService', () => {
  it('boots against the pgboss schema the Prisma migration installed', async () => {
    const [row] = await service.prisma.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM pgboss.version`
    expect(row?.version).toBe(46)
  })

  it('queues a job', async () => {
    const uploadId = randomUUID()
    const id = await service.app
      .get(JobsService)
      .send('contactUploadProcess', { uploadId })
    expect(id).toEqual(expect.any(String))
    expect(await queuedUploadIds()).toEqual([uploadId])
  })

  it('commits a job with the Prisma transaction it was sent in', async () => {
    const uploadId = randomUUID()
    await service.prisma.$transaction(async (tx) => {
      await service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId }, { tx })
      expect(await queuedUploadIds()).toEqual([])
    })
    expect(await queuedUploadIds()).toEqual([uploadId])
  })

  it('drops a job when its Prisma transaction rolls back', async () => {
    await expect(
      service.prisma.$transaction(async (tx) => {
        await service.app
          .get(JobsService)
          .send('contactUploadProcess', { uploadId: randomUUID() }, { tx })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await queuedUploadIds()).toEqual([])
  })

  it('rejects data that does not match the job schema', async () => {
    await expect(
      service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(await queuedUploadIds()).toEqual([])
  })

  it('makes every queue FIFO per group, with a heartbeat and a dead-letter queue', async () => {
    const rows = await service.prisma.$queryRaw<
      Array<{
        name: string
        policy: string
        dead_letter: string | null
        heartbeat_seconds: number | null
        retry_limit: number
      }>
    >`SELECT name, policy, dead_letter, heartbeat_seconds, retry_limit
      FROM pgboss.queue ORDER BY name`
    // A dead-letter queue has no worker, so only its existence matters.
    expect(rows).toMatchObject([
      {
        name: 'contactUploadProcess',
        policy: 'key_strict_fifo',
        dead_letter: 'contactUploadProcess-dlq',
        heartbeat_seconds: 60,
        retry_limit: 5,
      },
      { name: 'contactUploadProcess-dlq' },
    ])
  })

  it('puts a job sent without a group in a group of its own', async () => {
    const jobs = service.app.get(JobsService)
    const uploadId = randomUUID()
    const id = await jobs.send('contactUploadProcess', { uploadId })
    const grouped = await jobs.send(
      'contactUploadProcess',
      { uploadId: randomUUID() },
      { group: 'eo-springfield' },
    )
    const rows = await service.prisma.$queryRaw<
      Array<{ id: string; singleton_key: string }>
    >`SELECT id::text, singleton_key FROM pgboss.job
      WHERE name = 'contactUploadProcess' ORDER BY created_on`
    expect(rows).toEqual([
      { id, singleton_key: id },
      { id: grouped, singleton_key: 'eo-springfield' },
    ])
  })
})
