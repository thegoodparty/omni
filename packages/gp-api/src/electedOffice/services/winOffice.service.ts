import { ConflictException, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  ElectedOffice,
  ElectedOfficeWinSource,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { MarketingRevalidationService } from '@/personProfiles/services/marketing-revalidation.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  campaignWinState,
  servePartyFromCampaign,
} from '../util/winOffice.util'
import { ElectedOfficeService } from './electedOffice.service'
import { WinTermService } from './winTerm.service'

const SWEEP_JOB = 'winOfficeSweep'
// Small enough that the first runs work through the backfill of every past
// win (~3,100 in prod) in about two weeks, without a burst of creates and
// HubSpot Office Holder syncs.
export const WIN_OFFICE_SWEEP_BATCH = 200

const FUTURE_ELECTION_SQL = Prisma.sql`COALESCE(
  left(c.details->>'electionDate', 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
  AND left(c.details->>'electionDate', 10) > to_char(CURRENT_DATE, 'YYYY-MM-DD'),
  false
)`

// campaignWinState in SQL: didWin, then details.wonGeneral, then (unless a
// new election is ahead) the DDHQ-matched HubSpot election_results.
const RESULT_SQL = Prisma.sql`COALESCE(
  c.did_win,
  CASE WHEN jsonb_typeof(c.details->'wonGeneral') = 'boolean'
    THEN (c.details->>'wonGeneral')::boolean END,
  CASE WHEN ${FUTURE_ELECTION_SQL} THEN false END,
  CASE lower(trim(c.data->'hubSpotUpdates'->>'election_results'))
    WHEN 'won general' THEN true
    WHEN 'lost general' THEN false
  END
)`

// An ever-Pro winner's unfinished office sends them to Serve onboarding on
// every dashboard visit, so the sweep leaves out ever-Pro wins whose election
// is over a year old: the backfill must not start pushing long-past winners.
// Staff can still send one to /serve/onboarding, and the in-app paths still
// create the office when a result is written. Mirrors campaignWasEverPro in
// @goodparty_org/contracts; ->> reads a JSON null as SQL NULL.
const STALE_PRO_WIN_SQL = Prisma.sql`COALESCE(
  (c.is_pro
    OR c.details->>'isProUpdatedAt' IS NOT NULL
    OR c.details->>'subscriptionId' IS NOT NULL
    OR c.details->>'subscriptionCanceledAt' IS NOT NULL)
  AND left(c.details->>'electionDate', 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
  AND left(c.details->>'electionDate', 10)
    < to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM-DD'),
  false
)`

/**
 * Every win gets a dormant elected office: unfinished, so it gets no Serve
 * jobs and no redirects, but ready for staff to let its winner into Serve.
 * A win corrected to a loss, or cleared by a new race, removes it again
 * unless its holder already finished onboarding.
 */
@Injectable()
export class WinOfficeService extends createPrismaBase(MODELS.ElectedOffice) {
  constructor(
    private readonly electedOffices: ElectedOfficeService,
    private readonly winTerm: WinTermService,
    private readonly cronLock: CronLockService,
    private readonly revalidation: MarketingRevalidationService,
  ) {
    super()
  }

  /**
   * Brings a campaign's office in line with its result after a write that
   * could change it. Best effort: the result is already saved, and the sweep
   * repairs a miss on its next daily run.
   */
  async reconcile(
    campaignId: number,
    source: ElectedOfficeWinSource,
  ): Promise<void> {
    try {
      const campaign = await this.client.campaign.findUnique({
        where: { id: campaignId },
        select: { didWin: true, details: true, data: true },
      })
      if (!campaign) return
      const win = campaignWinState(campaign)
      if (win.state === 'won') await this.ensureForWin(campaignId, source)
      if (win.state === 'not_won') await this.removeDormantWinOffice(campaignId)
    } catch (err) {
      this.logger.error(
        { err, campaignId },
        'win office reconcile failed; the sweep retries',
      )
    }
  }

  /**
   * The office the Pro handoff creates, made on the server: linked to the
   * campaign, the campaign org's position, the party mapped to Serve's
   * values, checkpointed on `confirm`, and the BallotReady term when there is
   * one. Returns the campaign's existing office when it already has one.
   */
  async ensureForWin(
    campaignId: number,
    source: ElectedOfficeWinSource,
  ): Promise<ElectedOffice | null> {
    const linked = await this.model.findFirst({ where: { campaignId } })
    if (linked) return linked

    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { organization: true, user: true },
    })
    if (!campaign?.user || campaign.isDemo) return null
    const { organization: org, user } = campaign
    // Test mode builds its own offices; a create here would duplicate one.
    if (org?.testModeCreatedAt) return null

    const orgData = {
      positionId: org?.positionId ?? null,
      customPositionName: org?.customPositionName ?? null,
      overrideDistrictId: org?.overrideDistrictId ?? null,
    }
    const createArgs = {
      userId: user.id,
      campaignId,
      winSource: source,
      orgData,
      party: servePartyFromCampaign(campaign.details ?? {}),
      onboardingStep: 'confirm',
    }
    const term = await this.winTerm.forWinner(orgData.positionId, user)
    if (term) {
      try {
        return await this.electedOffices.create({ ...createArgs, ...term })
      } catch (err) {
        // A term that collides with an office they hold must not cost them
        // the office: create it term-less, as the Pro handoff does.
        if (!(err instanceof ConflictException)) throw err
      }
    }
    return this.electedOffices.create(createArgs)
  }

  /**
   * Deletes the campaign's office if a win created it and nobody finished
   * onboarding it, with everything its `eo-<id>` organization owns
   * (memberships, runs, priorities, cards) by cascade. The campaign row lock
   * orders this after any result write in flight, and the office row lock
   * after a pledge in flight, so a finished office is never removed.
   */
  async removeDormantWinOffice(campaignId: number): Promise<string[]> {
    const removed = await this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM campaign WHERE id = ${campaignId} FOR UPDATE`
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { didWin: true, details: true, data: true },
      })
      if (!campaign || campaignWinState(campaign).state !== 'not_won') {
        return { ids: [], personIds: [] }
      }
      const offices = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM elected_office
        WHERE campaign_id = ${campaignId}
          AND win_source IS NOT NULL
          AND onboarding_completed_at IS NULL
        FOR UPDATE`
      if (offices.length === 0) return { ids: [], personIds: [] }
      const ids = offices.map((office) => office.id)
      // The cascade takes the offices' priorities, and with them any issue a
      // live public profile shows.
      const profiles = await tx.personProfile.findMany({
        where: {
          publishedAt: { not: null },
          deletedAt: null,
          issues: { some: { priority: { electedOfficeId: { in: ids } } } },
        },
        select: { personId: true },
      })
      await tx.organization.deleteMany({
        where: {
          slug: { in: ids.map(OrganizationsService.electedOfficeOrgSlug) },
        },
      })
      return { ids, personIds: profiles.map(({ personId }) => personId) }
    })
    for (const personId of removed.personIds) {
      await this.revalidation.revalidatePerson(personId, [])
    }
    if (removed.ids.length > 0) {
      this.logger.info(
        { campaignId, electedOfficeIds: removed.ids },
        'removed dormant win office after the win was withdrawn',
      )
    }
    return removed.ids
  }

  @Cron('19 6 * * *', { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweep(now: Date = new Date()): Promise<void> {
    const claimed = await this.cronLock.tryClaimDailyRun(SWEEP_JOB, now)
    if (!claimed) return
    try {
      await this.sweepOnce()
    } finally {
      await this.cronLock.markCompleted(SWEEP_JOB, now)
    }
  }

  /**
   * One pass: offices for won campaigns that have none (newest first, so a
   * fresh DDHQ result is not stuck behind the backfill; an ever-Pro win over
   * a year old is skipped), then removal of
   * dormant win offices whose campaign now reads lost or is running again.
   * Catches every result written outside gp-api, and is the backfill.
   */
  async sweepOnce(): Promise<{ created: number; removed: number }> {
    const toCreate = await this.client.$queryRaw<{ id: number }[]>`
      SELECT c.id FROM campaign c
      LEFT JOIN organization o ON o.slug = c.organization_slug
      WHERE ${RESULT_SQL} IS TRUE
        AND NOT c.is_demo
        AND NOT ${STALE_PRO_WIN_SQL}
        AND o.test_mode_created_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM elected_office eo WHERE eo.campaign_id = c.id
        )
      ORDER BY c.id DESC
      LIMIT ${WIN_OFFICE_SWEEP_BATCH}`
    let created = 0
    for (const { id } of toCreate) {
      try {
        const campaign = await this.client.campaign.findUniqueOrThrow({
          where: { id },
          select: { didWin: true, details: true, data: true },
        })
        const win = campaignWinState(campaign)
        if (win.state !== 'won') continue
        if (await this.ensureForWin(id, win.source)) created++
      } catch (err) {
        this.logger.error({ err, campaignId: id }, 'win office create failed')
      }
    }

    const toRemove = await this.client.$queryRaw<{ campaignId: number }[]>`
      SELECT DISTINCT eo.campaign_id AS "campaignId" FROM elected_office eo
      JOIN campaign c ON c.id = eo.campaign_id
      WHERE eo.win_source IS NOT NULL
        AND eo.onboarding_completed_at IS NULL
        AND ${RESULT_SQL} IS FALSE
      LIMIT ${WIN_OFFICE_SWEEP_BATCH}`
    let removed = 0
    for (const { campaignId } of toRemove) {
      try {
        removed += (await this.removeDormantWinOffice(campaignId)).length
      } catch (err) {
        this.logger.error({ err, campaignId }, 'win office removal failed')
      }
    }

    this.logger.info(
      { created, removed, candidates: toCreate.length },
      'win office sweep finished',
    )
    return { created, removed }
  }
}
