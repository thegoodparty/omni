import { ConflictException, Injectable } from '@nestjs/common'
import {
  ElectedOffice,
  ElectedOfficeWinSource,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { MarketingRevalidationService } from '@/personProfiles/services/marketing-revalidation.service'
import { isPreparedOffice } from '../util/electedOffice.util'
import {
  canPrepareOffice,
  campaignWinState,
  PREPARE_WINDOW_DAYS,
  servePartyFromCampaign,
} from '../util/winOffice.util'
import { ElectedOfficeService } from './electedOffice.service'
import { WinTermService } from './winTerm.service'

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

// Mirrors campaignWasEverPro in @goodparty_org/contracts; ->> reads a JSON
// null as SQL NULL.
const EVER_PRO_SQL = Prisma.sql`(
  c.is_pro
  OR c.details->>'isProUpdatedAt' IS NOT NULL
  OR c.details->>'subscriptionId' IS NOT NULL
  OR c.details->>'subscriptionCanceledAt' IS NOT NULL
)`

// An ever-Pro winner's unfinished office sends them to Serve onboarding on
// every dashboard visit, so the sweep leaves out ever-Pro wins whose election
// is over a year old: the backfill must not start pushing long-past winners.
// Staff can still send one to /serve/onboarding, and the in-app paths still
// create the office when a result is written.
const STALE_PRO_WIN_SQL = Prisma.sql`COALESCE(
  ${EVER_PRO_SQL}
  AND left(c.details->>'electionDate', 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
  AND left(c.details->>'electionDate', 10)
    < to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM-DD'),
  false
)`

// canPrepareOffice in SQL: ever Pro, no result on record, and an election date
// that has passed within the prepare window. prepare() re-reads eligibility
// through the same rule, since a job can wait.
const PREPARABLE_SQL = Prisma.sql`COALESCE(
  ${EVER_PRO_SQL}
  AND ${RESULT_SQL} IS NULL
  AND left(c.details->>'electionDate', 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
  AND left(c.details->>'electionDate', 10) <= to_char(CURRENT_DATE, 'YYYY-MM-DD')
  AND left(c.details->>'electionDate', 10) >= to_char(
    CURRENT_DATE - make_interval(days => ${PREPARE_WINDOW_DAYS}::int),
    'YYYY-MM-DD'
  ),
  false
)`

/**
 * Every win gets a dormant elected office: unfinished, so it gets no Serve
 * jobs and no redirects, but ready for staff to let its winner into Serve.
 * A win corrected to a loss, or cleared by a new race, removes it again
 * unless its holder already finished onboarding.
 *
 * An ever-Pro campaign that reaches its election date with no result has an
 * office prepared ahead of the win, so Serve onboarding finds the meeting
 * schedule, community issues and ordinances already researched when it opens.
 * Prepared offices are invisible until a win turns them into one.
 */
@Injectable()
export class WinOfficeService extends createPrismaBase(MODELS.ElectedOffice) {
  constructor(
    private readonly electedOffices: ElectedOfficeService,
    private readonly winTerm: WinTermService,
    private readonly revalidation: MarketingRevalidationService,
    private readonly jobs: JobsService,
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
   * Builds the office an ever-Pro campaign's win will need, before there is a
   * result: shaped exactly like a win office, but with `pending` as its
   * source, so no read shows it and nothing treats it as a win. Its one-time
   * dispatches (meeting schedule, community issues, ordinance sourcing) run
   * now, so that research is waiting when the result lands; the briefing chain
   * and every scheduled Serve job stay gated on the pledge. Eligibility is
   * re-read here: a job can outlive the window it was sent in. Returns the
   * campaign's existing office, prepared or otherwise.
   */
  async prepare(campaignId: number): Promise<ElectedOffice | null> {
    const linked = await this.model.findFirst({ where: { campaignId } })
    if (linked) return linked

    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { organization: true, user: true },
    })
    if (!campaign?.user || campaign.isDemo) return null
    const { organization: org, user } = campaign
    if (org?.testModeCreatedAt) return null
    if (!canPrepareOffice(campaign)) return null

    // create() adopts one of the user's term-less placeholder offices over
    // making a new one, and a campaign win links that placeholder to the
    // campaign without a `winSource`. That office is not prepared (no
    // dispatches, and nothing marks it as pending), so the prepared sweep
    // would leave a campaign-linked office that the dashboard redirects its
    // holder into Serve onboarding with. A lead already waiting on Serve
    // onboarding is left to that flow.
    const placeholder = await this.client.electedOffice.findFirst({
      where: {
        userId: user.id,
        campaignId: null,
        termStartDate: null,
        termEndDate: null,
        organization: { testModeCreatedAt: null },
      },
      select: { id: true },
    })
    if (placeholder) {
      this.logger.debug(
        { campaignId, electedOfficeId: placeholder.id },
        'not preparing an office for a campaign whose holder has a lead office',
      )
      return null
    }

    const orgData = {
      positionId: org?.positionId ?? null,
      customPositionName: org?.customPositionName ?? null,
      overrideDistrictId: org?.overrideDistrictId ?? null,
    }
    const createArgs = {
      userId: user.id,
      campaignId,
      winSource: ElectedOfficeWinSource.pending,
      orgData,
      party: servePartyFromCampaign(campaign.details ?? {}),
      onboardingStep: 'confirm',
    }
    const term = await this.winTerm.forWinner(orgData.positionId, user)
    let office: ElectedOffice
    if (term) {
      try {
        office = await this.electedOffices.create({ ...createArgs, ...term })
      } catch (err) {
        // A term that collides with an office they hold must not cost them
        // this one: create it term-less, as the Pro handoff does.
        if (!(err instanceof ConflictException)) throw err
        office = await this.electedOffices.create(createArgs)
      }
    } else {
      office = await this.electedOffices.create(createArgs)
    }
    // create() dispatches for an office it created onboarded; a prepared one
    // is unfinished, so the dispatch is this caller's.
    if (isPreparedOffice(office)) {
      await this.electedOffices.dispatchScheduleAfterCreate(office)
    }
    return office
  }

  /**
   * The office the Pro handoff creates, made on the server: linked to the
   * campaign, the campaign org's position, the party mapped to Serve's
   * values, checkpointed on `confirm`, and the BallotReady term when there is
   * one. Returns the campaign's existing office when it already has one,
   * after turning a prepared one into this win's.
   */
  async ensureForWin(
    campaignId: number,
    source: ElectedOfficeWinSource,
  ): Promise<ElectedOffice | null> {
    const linked = await this.model.findFirst({ where: { campaignId } })
    if (linked) return this.adoptPrepared(linked, source)
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
   * Turns a prepared office into the win's. The claim lives on
   * ElectedOfficeService.claimPrepared, so every path that records a win —
   * reconcile, the sweep, and the in-app handoff's create — turns it the same
   * way.
   */
  private async adoptPrepared(
    office: ElectedOffice,
    source: ElectedOfficeWinSource,
  ): Promise<ElectedOffice> {
    return (await this.electedOffices.claimPrepared(office, source)) ?? office
  }

  /**
   * Deletes the campaign's office if a win created it and nobody finished
   * onboarding it, with everything its `eo-<id>` organization owns
   * (memberships, runs, priorities, cards) by cascade. The campaign row lock
   * orders this after any result write in flight, and the office row lock
   * after a pledge in flight, so a finished office is never removed.
   * `win_source` covers a prepared office too, so a loss deletes it.
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

  /**
   * The winOfficeSweep schedule's worker (src/jobs/jobs.registry.ts). Sends
   * one winOfficeSync job per won campaign with no office or only a prepared
   * one (newest first, so a fresh DDHQ result is not stuck behind the
   * backfill; an ever-Pro win over a year old is skipped), one per ever-Pro
   * campaign that has reached its election date with no result (the prepared
   * sweep), and one per dormant win office whose campaign now reads lost or
   * is running again. Catches every result written outside gp-api, and is the
   * backfill.
   *
   * Nothing is capped here. The first backfill run after the prepared sweep
   * shipped sees every eligible campaign at once, and a cap only moves the
   * rest of the queue to the next run; the winOfficeSync queue's
   * maxConcurrent is what keeps the creates and their HubSpot syncs from
   * stampeding.
   */
  async fanOut(job: JobRun<ScheduleData>): Promise<void> {
    const toCreate = await this.client.$queryRaw<{ id: number }[]>`
      SELECT c.id FROM campaign c
      LEFT JOIN organization o ON o.slug = c.organization_slug
      WHERE ${RESULT_SQL} IS TRUE
        AND NOT c.is_demo
        AND NOT ${STALE_PRO_WIN_SQL}
        AND o.test_mode_created_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM elected_office eo
          WHERE eo.campaign_id = c.id
            AND eo.win_source IS DISTINCT FROM 'pending'
        )
      ORDER BY c.id DESC`
    const toPrepare = await this.client.$queryRaw<{ id: number }[]>`
      SELECT c.id FROM campaign c
      LEFT JOIN organization o ON o.slug = c.organization_slug
      WHERE ${PREPARABLE_SQL}
        AND NOT c.is_demo
        AND o.test_mode_created_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM elected_office eo WHERE eo.campaign_id = c.id
        )
      ORDER BY c.id DESC`
    const toRemove = await this.client.$queryRaw<{ campaignId: number }[]>`
      SELECT DISTINCT eo.campaign_id AS "campaignId" FROM elected_office eo
      JOIN campaign c ON c.id = eo.campaign_id
      WHERE eo.win_source IS NOT NULL
        AND eo.onboarding_completed_at IS NULL
        AND ${RESULT_SQL} IS FALSE`
    // A campaign is in one of the first two lists or the last: its result is
    // true, unknown, or false.
    const campaignIds = [
      ...toCreate.map(({ id }) => id),
      ...toPrepare.map(({ id }) => id),
      ...toRemove.map(({ campaignId }) => campaignId),
    ]
    await this.jobs.sendMany(
      'winOfficeSync',
      campaignIds.map((campaignId) => ({
        data: { campaignId },
        key: `${campaignId}:${job.id}`,
      })),
    )
    this.logger.info(
      {
        toCreate: toCreate.length,
        toPrepare: toPrepare.length,
        toRemove: toRemove.length,
      },
      'win office sweep fanned out',
    )
  }

  /**
   * The winOfficeSync job's worker: what reconcile does, reading the source
   * from the result itself. A campaign with no result is prepared ahead of
   * one, and throwing retries the job.
   */
  async syncScheduled(job: JobRun<{ campaignId: number }>): Promise<void> {
    const { campaignId } = job.data
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      select: { didWin: true, details: true, data: true },
    })
    if (!campaign) return
    const win = campaignWinState(campaign)
    if (win.state === 'won') await this.ensureForWin(campaignId, win.source)
    if (win.state === 'not_won') await this.removeDormantWinOffice(campaignId)
    if (win.state === 'unknown') await this.prepare(campaignId)
  }
}
