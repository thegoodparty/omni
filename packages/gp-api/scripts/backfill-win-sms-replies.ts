/**
 * Backfill Win text reply bodies into PollIndividualMessage.
 *
 * The hourly inbound sweep stores reply text from the day it shipped. This
 * reads every Win p2p send still inside Peerly's report retention (about
 * 90 days) and runs the sweep's own message writer over both its current
 * job (projectId) and the job it replaced (previousJobId), which the sweep
 * never reads.
 *
 * Idempotent: message ids are uuidv5 of the row and writes skip duplicates,
 * so a re-run writes nothing new. Prints counts only, never reply text.
 *
 * Usage (NOT tsx: esbuild drops emitDecoratorMetadata, so every Nest provider
 * would be constructed with undefined dependencies):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-win-sms-replies.ts --dry-run
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/backfill-win-sms-replies.ts
 *
 * Required env vars: DATABASE_URL, PEERLY_* credentials.
 */
import '../src/configrc'

import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { subDays } from 'date-fns'
import { setTimeout as delay } from 'node:timers/promises'
import { ContactInteractionTextService } from '../src/contactInteraction/services/contactInteractionText.service'
import { OutreachType } from '../src/generated/prisma'
import { loggerModule } from '../src/observability/logging/logger-module'
import { OutreachInboundSweepService } from '../src/outreach/services/outreachInboundSweep.service'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { PeerlyHttpService } from '../src/vendors/peerly/services/peerlyHttp.service'
import { PeerlyJobResultsService } from '../src/vendors/peerly/services/peerlyJobResults.service'
import { PeerlyPhoneListCaptureService } from '../src/vendors/peerly/services/peerlyPhoneListCapture.service'

const RETENTION_DAYS = 90

// Peerly asked for one outstanding report request at a time.
const DELAY_BETWEEN_JOBS_MS = 2000

// AppModule is deliberately not used: it registers every scheduled job.
@Module({
  imports: [loggerModule, PrismaModule, HttpModule, JwtModule.register({})],
  providers: [
    PeerlyHttpService,
    PeerlyJobResultsService,
    PeerlyPhoneListCaptureService,
    ContactInteractionTextService,
    OutreachInboundSweepService,
  ],
})
class WinReplyBackfillModule {}

const main = async () => {
  const dryRun = process.argv.includes('--dry-run')
  const app = await NestFactory.createApplicationContext(
    WinReplyBackfillModule,
    { logger: ['error', 'warn'] },
  )
  try {
    const prisma = app.get(PrismaService)
    const sweep = app.get(OutreachInboundSweepService)
    const now = new Date()
    const since = subDays(now, RETENTION_DAYS)

    const outreaches = await prisma.outreach.findMany({
      where: {
        outreachType: OutreachType.p2p,
        campaignId: { not: null },
        phoneListId: { not: null },
        OR: [{ projectId: { not: null } }, { previousJobId: { not: null } }],
        AND: [
          {
            OR: [
              { date: { gte: since } },
              { date: null, createdAt: { gte: since } },
            ],
          },
        ],
      },
      include: { campaign: { select: { organizationSlug: true } } },
      orderBy: { id: 'asc' },
    })

    const totals = {
      sends: outreaches.length,
      jobsRead: 0,
      jobsFailed: 0,
      sendsWithoutCapture: 0,
      messagesFound: 0,
      messagesWritten: 0,
    }
    console.log(
      `${dryRun ? '[dry run] ' : ''}${outreaches.length} Win sends ` +
        `since ${since.toISOString()}`,
    )

    for (const outreach of outreaches) {
      const { campaign, campaignId } = outreach
      if (campaign === null || campaignId === null) continue
      const jobIds = [outreach.projectId, outreach.previousJobId].filter(
        (jobId): jobId is string => jobId !== null,
      )
      for (const jobId of jobIds) {
        try {
          const result = await sweep.backfillReplyMessages(
            { ...outreach, campaign, campaignId },
            jobId,
            now,
            dryRun,
          )
          if (result === null) {
            totals.sendsWithoutCapture += 1
            break
          }
          totals.jobsRead += 1
          totals.messagesFound += result.messagesFound
          totals.messagesWritten += result.messagesWritten
          console.log(
            `outreach ${outreach.id} job ${jobId}: ` +
              `${result.messagesFound} found, ` +
              `${result.messagesWritten} written`,
          )
        } catch (err) {
          totals.jobsFailed += 1
          // Message only: a raw axios error carries the request's auth
          // headers.
          console.error(
            `outreach ${outreach.id} job ${jobId} failed: ` +
              (err instanceof Error ? err.message : String(err)),
          )
        }
        await delay(DELAY_BETWEEN_JOBS_MS)
      }
    }

    console.log(JSON.stringify(totals))
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
