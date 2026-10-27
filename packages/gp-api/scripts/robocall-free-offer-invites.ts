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
 * treatment and control before the task is written. A dry run assigns
 * nothing and writes nothing.
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
import { differenceInCalendarWeeks } from 'date-fns'
import { ROBOCALL_FREE_OFFER_VARIANT } from '@goodparty_org/contracts'
import { CampaignTaskType, Prisma } from '../src/generated/prisma'
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

// Same line as the webapp's Home card (FREE_OFFER_HOME_BODY): the outcome,
// with the count left to the flow, where it is counted in voters.
const TASK_DESCRIPTION =
  'Reach voters the day before Election Day, at no cost to your campaign.'

// The task's button opens the robocall flow on the offer list. trackerTaskId
// and phase let the run complete the task once it is scheduled.
export const offerTaskLink = (trackerTaskId: string): string => {
  const params = new URLSearchParams({
    compose: 'robocall',
    recommended: ROBOCALL_FREE_OFFER_VARIANT,
    source: 'campaign_tracker',
    trackerTaskId,
    phase: 'gotv',
  })
  return `/dashboard/outreach?${params.toString()}`
}

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
        if (execute) await insertTask(prisma, campaign.id)
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

// Dated today and placed in the week of the campaign's own static anchor
// (its earliest pre-launch row), the way the plan's other rows are weeked.
// The link needs the row's id, so the row is written and then linked.
const insertTask = async (
  prisma: PrismaService,
  campaignId: number,
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const anchor = await tx.campaignTrackerTask.findFirst({
      where: { campaignId, isDefaultTask: true, phase: 'preLaunch' },
      orderBy: { date: Prisma.SortOrder.asc },
      select: { date: true },
    })
    const today = new Date()
    const row = await tx.campaignTrackerTask.create({
      data: {
        campaignId,
        title: ROBOCALL_FREE_OFFER_TASK_TITLE,
        description: TASK_DESCRIPTION,
        cta: 'Send outreach',
        flowType: CampaignTaskType.robocall,
        week: anchor
          ? Math.max(0, differenceInCalendarWeeks(today, anchor.date))
          : 0,
        date: today,
        proRequired: true,
        isDefaultTask: true,
        phase: 'gotv',
      },
    })
    await tx.campaignTrackerTask.update({
      where: { id: row.id },
      data: { link: offerTaskLink(row.id) },
    })
  })
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
