/**
 * Add the free election-eve robocall offer's plan task to every campaign the
 * offer applies to. Run once at launch, with the `robocall-free-offer` flag
 * on and ROBOCALL_FREE_OFFER_COUPON_ID set.
 *
 * Only campaigns that already have their default tracker rows get the task:
 * an early default row would stop materializeStaticTasks from ever building
 * the rest of the plan. A campaign that already has the task is skipped, so
 * a second run adds only what the first missed.
 *
 * With --execute, each invited campaign is enrolled exactly as its first
 * Home load would enroll it: its district's precincts are assigned to
 * treatment and control, and resolveOffer writes the task. A dry run
 * assigns nothing and writes nothing.
 *
 * Usage (NOT tsx: esbuild drops emitDecoratorMetadata, so every Nest provider
 * would be constructed with undefined dependencies):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/robocall-free-offer-invites.ts              # dry run
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/robocall-free-offer-invites.ts --execute
 *   Add --verbose for Nest's boot log.
 *
 * Required env vars: the gp-api set (DATABASE_URL, the people warehouse,
 * election database, Amplitude and Stripe keys).
 */
import '../src/configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Prisma } from '../src/generated/prisma'
import { AnalyticsModule } from '../src/analytics/analytics.module'
import { CampaignsModule } from '../src/campaigns/campaigns.module'
import { ElectionDbModule } from '../src/electionDb/electionDb.module'
import { FeaturesModule } from '../src/features/features.module'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  ROBOCALL_FREE_OFFER_ELECTION_DATE,
  ROBOCALL_FREE_OFFER_TASK_TITLE,
} from '../src/robocallFreeOffer/robocallFreeOffer.consts'
import { RobocallFreeOfferModule } from '../src/robocallFreeOffer/robocallFreeOffer.module'
import { RobocallFreeOfferService } from '../src/robocallFreeOffer/services/robocallFreeOffer.service'
import { SharedModule } from '../src/shared/shared.module'
import { UsersModule } from '../src/users/users.module'
import { BraintrustModule } from '../src/vendors/braintrust/braintrust.module'
import { GeminiModule } from '../src/vendors/google/gemini.module'

// AppModule is deliberately not used: it registers every @Cron job and the
// SQS consumer, which would start draining the real queue onto whichever
// machine runs this script. The @Global modules AppModule would provide are
// listed instead, since the offer's graph reaches providers from each.
@Module({
  imports: [
    loggerModule,
    PrismaModule,
    SharedModule,
    AnalyticsModule,
    UsersModule,
    CampaignsModule,
    ElectionDbModule,
    FeaturesModule,
    BraintrustModule,
    GeminiModule,
    RobocallFreeOfferModule,
  ],
})
class RobocallFreeOfferInvitesModule {}

const main = async () => {
  const execute = process.argv.includes('--execute')
  const verbose = process.argv.includes('--verbose')
  // An app with an HTTP adapter rather than a bare context: a dev-only vendor
  // mock controller in the graph registers a body parser on the adapter.
  // init() wires everything; nothing listens on a port.
  const app = await NestFactory.create(
    RobocallFreeOfferInvitesModule,
    new FastifyAdapter(),
    { logger: verbose ? ['log', 'error', 'warn', 'debug'] : ['error', 'warn'] },
  )
  await app.init()

  try {
    const prisma = app.get(PrismaService)
    const offer = app.get(RobocallFreeOfferService)
    if (!offer.isConfigured()) {
      throw new Error('ROBOCALL_FREE_OFFER_COUPON_ID is not set')
    }

    // The cheap rules as a query; the service applies all of them again.
    const candidates = await prisma.campaign.findMany({
      where: {
        isPro: true,
        organizationSlug: { startsWith: 'campaign-' },
        details: {
          path: ['electionDate'],
          equals: ROBOCALL_FREE_OFFER_ELECTION_DATE,
        },
        campaignTrackerTasks: { some: { isDefaultTask: true } },
        NOT: {
          campaignTrackerTasks: {
            some: { title: ROBOCALL_FREE_OFFER_TASK_TITLE },
          },
        },
      },
      include: { organization: true },
      orderBy: { id: Prisma.SortOrder.asc },
    })
    console.log(
      `${candidates.length} candidate campaigns` +
        (execute ? '' : ' (dry run: nothing is assigned or written)'),
    )

    const invited: number[] = []
    const failed: number[] = []
    for (const campaign of candidates) {
      const { organization } = campaign
      if (!organization) continue
      try {
        const offered = execute
          ? (await offer.resolveOffer(organization, campaign)) !== null
          : await offer.wouldOffer(organization, campaign)
        if (!offered) continue
        invited.push(campaign.id)
        console.log(`  campaign ${campaign.id}: invited`)
      } catch (err) {
        failed.push(campaign.id)
        console.error(`  campaign ${campaign.id}: failed`, err)
      }
    }

    console.log(
      `${invited.length} ${execute ? 'invited' : 'would be invited'}, ` +
        `${failed.length} failed` +
        (failed.length ? ` (${failed.join(', ')})` : ''),
    )
  } finally {
    await app.close()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
