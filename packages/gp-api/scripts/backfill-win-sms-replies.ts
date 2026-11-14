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
import { ContactInteractionTextService } from '../src/contactInteraction/services/contactInteractionText.service'
import { loggerModule } from '../src/observability/logging/logger-module'
import { OutreachInboundSweepService } from '../src/outreach/services/outreachInboundSweep.service'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PeerlyHttpService } from '../src/vendors/peerly/services/peerlyHttp.service'
import { PeerlyJobResultsService } from '../src/vendors/peerly/services/peerlyJobResults.service'
import { PeerlyPhoneListCaptureService } from '../src/vendors/peerly/services/peerlyPhoneListCapture.service'

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
    const { jobs, failedJobs, since, ...totals } = await app
      .get(OutreachInboundSweepService)
      .backfillWinReplies(dryRun)
    console.log(
      `${dryRun ? '[dry run] ' : ''}${totals.sends} Win sends ` +
        `since ${since.toISOString()}`,
    )
    for (const { outreachId, jobId, found, written } of jobs) {
      console.log(
        `outreach ${outreachId} job ${jobId}: ${found} found, ${written} written`,
      )
    }
    for (const { outreachId, jobId, error } of failedJobs) {
      console.error(`outreach ${outreachId} job ${jobId} failed: ${error}`)
    }
    console.log(JSON.stringify({ ...totals, jobsFailed: failedJobs.length }))
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
