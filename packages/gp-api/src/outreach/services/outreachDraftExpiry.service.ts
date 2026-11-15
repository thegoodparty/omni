import { Injectable } from '@nestjs/common'
import { subDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { PrismaService } from '@/prisma/prisma.service'
import { OutreachStatus } from '../../generated/prisma'
import { OutreachDraftService } from './outreachDraft.service'

export const DRAFT_RETENTION_DAYS = 90

// A candidate who cannot send yet may still build and abandon several
// drafts; this bounds how long an abandoned draft (and its S3 image/audio)
// sits around unused.
@Injectable()
export class OutreachDraftExpiryService {
  constructor(
    private readonly drafts: OutreachDraftService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachDraftExpiryService.name)
  }

  // The outreachDraftExpiry schedule's worker (src/jobs/jobs.registry.ts).
  // Runs in every environment: it spends no money and hits no vendor, and a
  // dev-only draft pile-up is exactly what it exists to prevent.
  async fanOut(job: JobRun<ScheduleData>): Promise<void> {
    const rows = await this.prisma.outreach.findMany({
      where: {
        status: OutreachStatus.draft,
        createdAt: { lt: subDays(new Date(), DRAFT_RETENTION_DAYS) },
      },
      select: { id: true },
    })
    await this.jobs.sendMany(
      'outreachDraftExpire',
      rows.map(({ id }) => ({
        data: { outreachId: id },
        key: `${id}:${job.id}`,
      })),
    )
  }

  // The outreachDraftExpire job's worker. Read again here: the draft may
  // have been resumed or deleted since the schedule found it.
  async expireDraft(job: JobRun<{ outreachId: number }>): Promise<void> {
    const { outreachId } = job.data
    const row = await this.prisma.outreach.findFirst({
      where: {
        id: outreachId,
        status: OutreachStatus.draft,
        createdAt: { lt: subDays(new Date(), DRAFT_RETENTION_DAYS) },
      },
      include: { robocall: true, email: { select: { imageUrl: true } } },
    })
    if (!row) return
    await this.drafts.deleteDraftRow(row)
    this.logger.info(
      { outreachId: row.id, outreachType: row.outreachType },
      'outreach draft expired',
    )
  }
}
