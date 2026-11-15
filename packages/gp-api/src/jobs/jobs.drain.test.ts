import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import { JOBS, type Jobs, type Schedules } from './jobs.registry'
import { JobsService } from './jobs.service'

const service = useTestService()

// A gp-api task with the settings it runs with in prod: NOTIFY wake-ups and
// pg-boss's real polling intervals, not the test ones. JobsService reads
// NODE_ENV when it is imported, so this imports a fresh copy outside test.
// No schedules: this task must not run the real crons.
const startProdLikeTask = async (jobs: Jobs): Promise<JobsService> => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.resetModules()
  try {
    const { JobsService: ProdJobsService } = await import('./jobs.service.js')
    const task = new ProdJobsService(
      jobs,
      {} as Schedules,
      service.app.get(PrismaService),
      service.app.get(ModuleRef),
      await service.app.resolve(PinoLogger),
    )
    await task.onModuleInit()
    await task.onApplicationBootstrap()
    return task
  } finally {
    vi.unstubAllEnvs()
  }
}

const waitFor = async (check: () => boolean, timeoutMs: number) => {
  const deadline = performance.now() + timeoutMs
  while (!check()) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(50)
  }
}

describe('JobsService draining a backlog', () => {
  it('runs 50 queued jobs back to back, not one per worker per poll', async () => {
    const ran: string[] = []
    const task = await startProdLikeTask({
      ...JOBS,
      contactUploadProcess: {
        ...JOBS.contactUploadProcess,
        worker: async (job) => {
          ran.push(job.data.uploadId)
        },
      },
    })
    try {
      const startedAt = performance.now()
      await service.app.get(JobsService).sendMany(
        'contactUploadProcess',
        Array.from({ length: 50 }, (_, index) => ({
          data: { uploadId: randomUUID() },
          key: String(index),
        })),
      )
      await waitFor(() => ran.length === 50, 20_000)

      // Four workers, each waiting out the 30-second NOTIFY backstop after
      // every job, would take about six minutes.
      expect(performance.now() - startedAt).toBeLessThan(10_000)
    } finally {
      await task.onModuleDestroy()
    }
  })

  it('runs a group one job at a time, in send order, without waiting between them', async () => {
    let running = 0
    let mostRunning = 0
    const ran: string[] = []
    const task = await startProdLikeTask({
      ...JOBS,
      contactUploadProcess: {
        ...JOBS.contactUploadProcess,
        worker: async (job) => {
          running++
          mostRunning = Math.max(mostRunning, running)
          await sleep(20)
          ran.push(job.data.uploadId)
          running--
        },
      },
    })
    try {
      const uploadIds = Array.from({ length: 10 }, () => randomUUID())
      const startedAt = performance.now()
      for (const uploadId of uploadIds) {
        await service.app
          .get(JobsService)
          .send('contactUploadProcess', { uploadId }, { group: 'org-1' })
      }
      await waitFor(() => ran.length === 10, 20_000)

      expect(performance.now() - startedAt).toBeLessThan(10_000)
      expect(ran).toEqual(uploadIds)
      expect(mostRunning).toBe(1)
    } finally {
      await task.onModuleDestroy()
    }
  })
})
