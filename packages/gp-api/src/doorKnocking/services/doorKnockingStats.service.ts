import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours } from 'date-fns'
import pMap from 'p-map'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Prisma } from '../../generated/prisma'

// The nine running totals from the HubSpot canvassing-properties doc, all
// org-scoped and all-time. Every one of them is a RUNNING TOTAL rather than a
// delta, because HubSpot workflows can copy a value onto a property but cannot
// sum across events — so whatever arrives here is what the property will read.
export type DoorKnockingCanvassingTotals = {
  uniqueDoorsKnocked: number
  doorAttempts: number
  uniqueContactsMade: number
  totalContactsMade: number
  committedVoters: number
  votersPersuaded: number
  uniqueTurfsCreated: number
  uniqueTurfsCompleted: number
  lastCanvassActivityAt: Date | null
}

// Rolled up daily rather than per knock: a canvasser logs dozens a session and
// each would trigger an org-wide aggregate, for properties nobody reads in
// real time. The sweep is what keeps the knock-driven numbers fresh between
// the two list-lifecycle moments that fire directly.
const SWEEP_JOB = 'door_knocking_canvassing_totals'
// 05:00 Eastern: after the latest a canvasser plausibly syncs an evening walk,
// before the CS workday reads the properties.
const SWEEP_CRON = '0 5 * * *'
const SWEEP_WINDOW_HOURS = 24
// Each org is one aggregate query plus one Segment call, so the fan-out is
// bounded for the DB rather than for a vendor rate limit.
const SWEEP_CONCURRENCY = 5

// A door-knock outcome counts as a CONTACT when somebody came to the door.
//
// `refused_to_engage` is in here deliberately, and it is the one definition in
// this file that is a judgement call rather than a reading of the data. The
// knock form's second step OVERWRITES the first, so a door that physically
// opened and then refused persists as a single `refused_to_engage` row,
// indistinguishable from one that never opened at all. Excluding the outcome
// therefore undercounts real conversations rather than excluding non-answers.
// Pending CS sign-off; changing it is a one-line edit here.
const CONTACT_OUTCOMES = ['answered', 'refused_to_engage']

@Injectable()
export class DoorKnockingStatsService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  // Deliberately allowed to reject. Every call site outside the sweep fires
  // this as `void … .catch(() => undefined)` per the analytics standard, so a
  // Segment hiccup or a slow aggregate cannot fail a canvasser's write; the
  // sweep catches per org and logs, which is where a systematically broken
  // query becomes visible rather than silently absent.
  async emitCanvassingTotals(
    userId: number,
    organizationSlug: string,
  ): Promise<void> {
    const [totals, actor, campaign] = await Promise.all([
      this.canvassingTotals(organizationSlug),
      this.client.user.findUnique({
        where: { id: userId },
        select: { email: true, metaData: true },
      }),
      // `organizationSlug` is unique on Campaign, and a Serve (`eo-`) org has
      // no row at all — so both ids below are null for one, which is the
      // documented Serve shape rather than a failure.
      this.client.campaign.findUnique({
        where: { organizationSlug },
        select: { id: true, data: true },
      }),
    ])

    // `email` and `hubspotContactId` are already attached as Segment context
    // traits by AnalyticsService. They ride the payload as well because the
    // HubSpot workflow reads event properties, not context, and CS asked for
    // both ids on the event itself.
    await this.analytics.track(
      userId,
      EVENTS.DoorKnocking.CanvassingTotalsUpdated,
      {
        email: actor?.email ?? null,
        hubspotContactId: actor?.metaData?.hubspotId ?? null,
        hubspotCompanyId: campaign?.data.hubspotId ?? null,
        organizationSlug,
        campaignId: campaign?.id ?? null,
        ...totals,
        lastCanvassActivityAt:
          totals.lastCanvassActivityAt?.toISOString() ?? null,
      },
    )
  }

  // One statement for all nine numbers. They share the org's whole knock
  // history, so nine queries would scan the same rows nine times; the `knock`
  // CTE is referenced repeatedly, which is exactly the case Postgres
  // materializes rather than inlining.
  async canvassingTotals(
    organizationSlug: string,
  ): Promise<DoorKnockingCanvassingTotals> {
    const [row] = await this.client.$queryRaw<DoorKnockingCanvassingTotals[]>`
      WITH knock AS (
        SELECT
          person_id,
          occurred_at,
          id,
          outcome::text AS outcome,
          support_answer::text AS support_answer,
          will_vote::text AS will_vote
        FROM contact_interaction_door_knock
        WHERE organization_slug = ${organizationSlug}
      ),
      -- Every turf-derived number below reads this one scope: alive lists
      -- only. A tombstoned list is unreachable from every read path in the
      -- product, so reporting its doors would describe work the candidate can
      -- no longer see. The interaction-derived numbers make the opposite
      -- choice, and cannot make this one — knock rows hang off the
      -- organization rather than the turf and outlive it by design.
      turf AS (
        SELECT tf.id, r.id AS route_id
        FROM door_knocking_turf tf
        JOIN voter_file_filter vff ON vff.id = tf.voter_file_filter_id
        LEFT JOIN door_knocking_route r ON r.door_knocking_turf_id = tf.id
        WHERE vff.organization_slug = ${organizationSlug}
          AND tf.deleted_at IS NULL
      ),
      -- There is no completedAt on the turf by design: the lifecycle lives on
      -- the Outreach envelope, reached through the route.
      completed_turf AS (
        SELECT t.id
        FROM turf t
        JOIN outreach o ON o.door_knocking_route_id = t.route_id
        WHERE o.status = 'completed'
      ),
      -- The effective per-person knock status, mirroring
      -- DoorKnockingStatusService.latestKnockStatuses: the latest
      -- answer-bearing row wins over a later answerless one, so a re-attempt
      -- that found nobody home does not retract support already given.
      latest_knock AS (
        SELECT DISTINCT ON (person_id) person_id, outcome, support_answer
        FROM knock
        ORDER BY
          person_id,
          (support_answer IS NOT NULL) DESC,
          occurred_at DESC,
          id DESC
      ),
      support_override AS (
        SELECT person_id, value
        FROM contact_current_status
        WHERE organization_slug = ${organizationSlug}
          AND field = 'support_status'
      ),
      -- "Somebody behind this door has been written down." A manual override
      -- wins where it maps to a real status; 'unknown'/'undecided' override
      -- back to nothing-known, and an unrecognised value falls through to the
      -- interaction, exactly as overrideToKnockStatus does.
      logged_person AS (
        SELECT COALESCE(k.person_id, o.person_id) AS person_id
        FROM latest_knock k
        FULL JOIN support_override o ON o.person_id = k.person_id
        WHERE CASE
          WHEN o.value IN ('supporter', 'non_supporter', 'refused') THEN TRUE
          WHEN o.value IN ('unknown', 'undecided') THEN FALSE
          ELSE k.support_answer IN ('supporter', 'non_supporter')
            OR k.outcome IN (
              'refused_to_engage', 'inaccessible', 'not_a_voter', 'not_home'
            )
        END
      ),
      -- Two targets are the same DOOR when they share a stop and an address
      -- key, the pair DoorKnockingTurfCountsService uses and for the reason
      -- its header gives: stops are grouped by COORDINATE, so one address key
      -- geocoded twice is two doors. Unlike that service this does NOT add
      -- doors with nobody knockable behind them — those exist there so a
      -- do-not-knock house cannot hold a progress bar below 100%, and counting
      -- them as knocked here would report doors nobody went to.
      door AS (
        SELECT DISTINCT s.id AS stop_id, t.address_key
        FROM door_knocking_stop_target t
        JOIN door_knocking_stop s ON s.id = t.door_knocking_stop_id
        JOIN door_knocking_route r ON r.id = s.door_knocking_route_id
        JOIN turf tf ON tf.id = r.door_knocking_turf_id
        WHERE t.person_id IN (SELECT person_id FROM logged_person)
      ),
      -- A mind changed at a door: an earlier non_supporter answer followed by
      -- a later supporter one. Not knowable at write time — the knock write
      -- never reads prior status — which is why it is derived in the rollup
      -- rather than emitted as its own event. Historical: a person who flips
      -- back later stays counted, because the persuasion still happened.
      persuaded AS (
        SELECT DISTINCT person_id
        FROM (
          SELECT
            person_id,
            support_answer,
            bool_or(support_answer = 'non_supporter') OVER (
              PARTITION BY person_id
              ORDER BY occurred_at, id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS had_non_supporter
          FROM knock
          WHERE support_answer IS NOT NULL
        ) w
        WHERE support_answer = 'supporter' AND had_non_supporter
      ),
      -- Door-attributed on purpose, so this is NOT
      -- SupportStatusService.derivedStatusSql, which unions phone banking.
      -- The two answers have their own latest row: a canvasser can capture
      -- support on one visit and the GOTV answer on the next.
      latest_support AS (
        SELECT DISTINCT ON (person_id) person_id, support_answer
        FROM knock
        WHERE support_answer IS NOT NULL
        ORDER BY person_id, occurred_at DESC, id DESC
      ),
      latest_will_vote AS (
        SELECT DISTINCT ON (person_id) person_id, will_vote
        FROM knock
        WHERE will_vote IS NOT NULL
        ORDER BY person_id, occurred_at DESC, id DESC
      )
      SELECT
        (SELECT COUNT(*) FROM door)::int AS "uniqueDoorsKnocked",
        (SELECT COUNT(*) FROM knock)::int AS "doorAttempts",
        (
          SELECT COUNT(DISTINCT person_id) FROM knock
          WHERE outcome IN (${Prisma.join(CONTACT_OUTCOMES)})
        )::int AS "uniqueContactsMade",
        (
          SELECT COUNT(*) FROM knock
          WHERE outcome IN (${Prisma.join(CONTACT_OUTCOMES)})
        )::int AS "totalContactsMade",
        (
          SELECT COUNT(*)
          FROM latest_support ls
          JOIN latest_will_vote lw ON lw.person_id = ls.person_id
          WHERE ls.support_answer = 'supporter' AND lw.will_vote = 'yes'
        )::int AS "committedVoters",
        (SELECT COUNT(*) FROM persuaded)::int AS "votersPersuaded",
        (SELECT COUNT(*) FROM turf)::int AS "uniqueTurfsCreated",
        (SELECT COUNT(*) FROM completed_turf)::int AS "uniqueTurfsCompleted",
        (SELECT MAX(occurred_at) FROM knock) AS "lastCanvassActivityAt"
    `

    // A scalar-subquery SELECT with no FROM always returns exactly one row, so
    // this only narrows the type — it is not a case any org can reach.
    if (!row) {
      throw new Error(
        `door-knocking canvassing totals returned no row for ${organizationSlug}`,
      )
    }
    return row
  }

  // The knock-driven numbers move without anyone touching a list, so the two
  // lifecycle moments that fire directly (create, complete) would leave a
  // week's canvassing invisible on an org that is walking lists it already
  // made. Scoped to orgs that recorded a knock in the window rather than to
  // every org with a turf: the rest cannot have moved.
  @Cron(SWEEP_CRON, { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepCanvassingTotals(): Promise<void> {
    const now = new Date()
    if (!(await this.cronLock.tryClaimDailyRun(SWEEP_JOB, now))) return

    const since = subHours(now, SWEEP_WINDOW_HOURS)
    // `createdAt`, not `occurredAt`: the window asks which rows LANDED since
    // the last sweep. A phone syncing a walk it did offline yesterday, and a
    // manual log backdated to last week, both need to move the totals, and
    // neither has an `occurredAt` inside the window.
    const active = await this.model.groupBy({
      by: ['organizationSlug'],
      where: { createdAt: { gte: since } },
    })

    await pMap(
      active,
      async ({ organizationSlug }) => {
        try {
          const organization = await this.client.organization.findUnique({
            where: { slug: organizationSlug },
            select: { ownerId: true },
          })
          if (!organization) return

          // The org owner, not whoever knocked. Segment identifies by user and
          // these totals are the organization's, so on a team account the
          // owner is the one HubSpot contact the company's properties should
          // hang off — otherwise a volunteer's overnight sync would move the
          // candidate's numbers onto the volunteer's contact record.
          await this.emitCanvassingTotals(
            organization.ownerId,
            organizationSlug,
          )
        } catch (error) {
          this.logger.error(
            { error, organizationSlug },
            'failed to emit door-knocking canvassing totals for org; continuing',
          )
        }
      },
      { concurrency: SWEEP_CONCURRENCY },
    )

    await this.cronLock.markCompleted(SWEEP_JOB, now)
  }
}
