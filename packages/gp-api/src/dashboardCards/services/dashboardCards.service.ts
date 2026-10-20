import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, endOfWeek, startOfWeek } from 'date-fns'
import {
  CommunityIssue,
  DashboardCard,
  DashboardCardType,
  ElectedOffice,
  MeetingBriefing,
  OutreachType,
  Prisma,
  Priority,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  CIVIC_PANEL_BUILD_CARD_CTA,
  CIVIC_PANEL_BUILD_CARD_HREF,
  CIVIC_PANEL_PAGE_HREF,
  CIVIC_PANEL_STEP_CARD_PREFIX,
  civicPanelBuildCardSourceId,
  civicPanelStandingLine,
  civicPanelStepCardSourceId,
  type CivicPanelBuildChannel,
  type CivicPanelBuildPlanResponse,
  DASHBOARD_CARD_SNOOZE_DAYS,
  DashboardCardBucket,
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  READ_REPRESENTATIVENESS_LABELS,
  type PriorityReadStatus,
} from '@goodparty_org/contracts'
import { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import { currentStepOf } from '@/priorities/util/priority.util'
import {
  briefingItemHref,
  briefingOverviewHref,
} from '../util/briefingHref.util'
import { BriefingArtifactCardSourceSchema } from '../schemas/briefingArtifactCardSource.schema'
import {
  OutreachReportBackService,
  REPORT_BACK_DUE_DAYS,
} from '@/outreach/services/outreachReportBack.service'
import { CivicPanelBuildPlanService } from '@/contacts/services/civicPanelBuildPlan.service'
import { UNSENT_OUTREACH_STATUSES } from '@/outreach/util/unsentOutreachStatuses.util'

// Community issues have no natural deadline; give their cards a fixed window so
// they ride the existing active/this_week/missed bucketing off dueDate.
const COMMUNITY_ISSUE_CARD_DUE_DAYS = 7

// Same reason as above: recruiting has no deadline, and the window is what
// keeps an untouched card from sitting on the home page forever.
const CIVIC_PANEL_CARD_DUE_DAYS = 30

// The priority's own page, so the card and the Priorities page open the one
// conversation the priority keeps, and its steps and sends are recorded there.
export const civicPanelCardHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}`

type PriorityForCard = Pick<
  Priority,
  'id' | 'title' | 'status' | 'currentStep' | 'nextAction'
>

// A priority whose every step is settled: the page's "Plan ready". It has no
// next step, so it has no card.
const isPlanReady = (priority: PriorityForCard): boolean =>
  currentStepOf(priority) === null

// What the Priorities page shows for the priority: its "Next" line, or with
// none, the step badge, so the card and the page never disagree. A step id
// this build does not know gets no badge on the page, so the card reads it as
// not started.
const priorityStepLabel = (priority: PriorityForCard): string => {
  const currentStep = currentStepOf(priority)
  const step =
    PRIORITY_STEP_IDS.find((id) => id === currentStep) ?? PRIORITY_STEP_IDS[0]
  return PRIORITY_STEP_LABELS[step]
}

const priorityNextStepCardContent = (priority: PriorityForCard) => ({
  title: priority.title,
  summary: priority.nextAction?.trim() || priorityStepLabel(priority),
  ctaLabel: 'Open priority',
  ctaHref: civicPanelCardHref(priority.id),
})

// The priority's own conversation, told which send to report back on; the
// workspace starts the report back with one hidden turn.
export const reportBackCardHref = (
  priorityId: string,
  outreachId: number,
): string => `${civicPanelCardHref(priorityId)}?reportBack=${outreachId}`

// Where the read stands, then the one thing to do: tell the people who
// answered what you heard. A card is made for each status a priority's read
// reaches, so the words always match what the priority page shows.
const reportBackCardContent = (
  outreachId: number,
  priorityId: string,
  priorityTitle: string,
  read: Pick<PriorityReadStatus, 'good' | 'status'>,
) => ({
  title: `Show people their voice counted on ${priorityTitle}`,
  summary: read.good
    ? `${READ_REPRESENTATIVENESS_LABELS[read.status]}. Tell everyone who answered what you heard.`
    : `${READ_REPRESENTATIVENESS_LABELS[read.status]}. Tell everyone who answered what you heard so far.`,
  ctaLabel: 'Report back',
  ctaHref: reportBackCardHref(priorityId, outreachId),
})

const CIVIC_PANEL_BUILD_CARD_CONTENT = {
  title: 'Start with the people you represent',
  summary:
    'A civic panel is a group of residents who agree to tell you what ' +
    'they think before you decide.',
  ctaLabel: CIVIC_PANEL_BUILD_CARD_CTA,
  ctaHref: CIVIC_PANEL_BUILD_CARD_HREF,
}

const CIVIC_PANEL_ACTIVE_CARD_TITLE = 'Hear from more than the loudest voices'

// The panel page's own button words for the step the card points at.
const START_STEP_LABELS: Record<CivicPanelBuildChannel, string> = {
  text: 'Start the text',
  phone_banking: 'Start the calls',
  door_knocking: 'Start door knocking',
}
const KEEP_GOING_LABELS: Record<CivicPanelBuildChannel, string> = {
  text: 'See your plan',
  phone_banking: 'Keep calling',
  door_knocking: 'Keep knocking',
}

// Before a plan, the card asks the official to start; once there is one, it
// leads with the value and opens the plan's next step.
export const civicPanelBuildCardContent = (
  panel: CivicPanelBuildPlanResponse,
): typeof CIVIC_PANEL_BUILD_CARD_CONTENT => {
  const { next, plan, progress } = panel
  if (!plan || plan.status !== 'active' || !next) {
    return CIVIC_PANEL_BUILD_CARD_CONTENT
  }
  const ctaLabel =
    next.channel === null || next.href === null
      ? 'See your plan'
      : next.status === 'not_started'
        ? START_STEP_LABELS[next.channel]
        : KEEP_GOING_LABELS[next.channel]
  return {
    title: CIVIC_PANEL_ACTIVE_CARD_TITLE,
    summary: civicPanelStandingLine(progress),
    ctaLabel,
    ctaHref: next.href ?? CIVIC_PANEL_PAGE_HREF,
  }
}

type DesiredCard = {
  type: DashboardCardType
  sourceItemId: string | null
  title: string
  summary: string
  ctaLabel: string
  ctaHref: string
  dueDate: Date
}

@Injectable()
export class DashboardCardsService extends createPrismaBase(
  MODELS.DashboardCard,
) {
  constructor(
    private readonly reportBack: OutreachReportBackService,
    private readonly moduleRef: ModuleRef,
  ) {
    super()
  }

  // One "Report back" card per priority: it goes to everyone who answered on
  // any channel, and a new one is made each time the priority's read status
  // changes, so a card shows when there is something new to tell people. The
  // card is keyed on the priority and its status. Only the card for the
  // current status stays open, due two weeks out. It is done once a report
  // back goes out (past checkout) after the card was made, or when the
  // official marks it done.
  async syncReportBackCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    const sends = await this.client.outreach.findMany({
      where: this.reportBack.repliesInWhere(
        electedOffice.organizationSlug,
        electedOffice.id,
      ),
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: {
        id: true,
        priorityId: true,
        priority: { select: { title: true } },
      },
    })
    const anchors = new Map<string, (typeof sends)[number]>()
    for (const send of sends) {
      if (send.priorityId !== null && !anchors.has(send.priorityId)) {
        anchors.set(send.priorityId, send)
      }
    }
    // A read is a warehouse read, so it happens before the lock is taken.
    const reads =
      anchors.size === 0
        ? new Map<string, PriorityReadStatus>()
        : await this.moduleRef
            .get(PriorityResultsService, { strict: false })
            .readStatuses(electedOffice.organizationSlug, [...anchors.keys()])
    await this.client.$transaction(async (tx) => {
      // Same reason as the panel cards: a null sourceItemId leaves the
      // unique key unable to stop the home page and the archive both
      // inserting one.
      const lockKey = `report_back_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const existing = await tx.dashboardCard.findMany({
        where: {
          electedOfficeId: electedOffice.id,
          type: DashboardCardType.report_back,
        },
        select: {
          id: true,
          sourceExternalId: true,
          sourceItemId: true,
          completedAt: true,
          title: true,
          summary: true,
          ctaLabel: true,
          ctaHref: true,
        },
      })
      const now = new Date()
      // Cards made one per send, before there was one per priority, and open
      // cards whose status is no longer the priority's.
      const stale = existing.filter((card) => {
        if (card.completedAt !== null) return false
        const read = reads.get(card.sourceExternalId)
        return card.sourceItemId === null || read?.status !== card.sourceItemId
      })
      if (stale.length > 0) {
        await tx.dashboardCard.deleteMany({
          where: { id: { in: stale.map((card) => card.id) } },
        })
      }
      const staleIds = new Set(stale.map((card) => card.id))
      const live = existing.filter((card) => !staleIds.has(card.id))
      for (const [priorityId, send] of anchors) {
        const read = reads.get(priorityId)
        if (!read || read.answers === 0) continue
        const content = reportBackCardContent(
          send.id,
          priorityId,
          send.priority?.title ?? '',
          read,
        )
        const card = live.find(
          (c) =>
            c.sourceExternalId === priorityId && c.sourceItemId === read.status,
        )
        if (!card) {
          await tx.dashboardCard.create({
            data: {
              electedOfficeId: electedOffice.id,
              type: DashboardCardType.report_back,
              sourceExternalId: priorityId,
              sourceItemId: read.status,
              ...content,
              dueDate: addDays(now, REPORT_BACK_DUE_DAYS),
            },
          })
        } else if (
          card.title !== content.title ||
          card.summary !== content.summary ||
          card.ctaLabel !== content.ctaLabel ||
          card.ctaHref !== content.ctaHref
        ) {
          await tx.dashboardCard.update({
            where: { id: card.id },
            data: content,
          })
        }
      }
    })
    // After the cards above are committed, so the newest one is the one a
    // report back is measured against. Every open card, the ones just made
    // included: a report back can be past checkout before its card's first
    // read.
    const open = await this.client.dashboardCard.findMany({
      where: {
        electedOfficeId: electedOffice.id,
        type: DashboardCardType.report_back,
        completedAt: null,
      },
      select: { id: true, sourceExternalId: true },
    })
    for (const card of open) {
      if (
        await this.reportBack.sentReportBack(
          electedOffice.organizationSlug,
          card.sourceExternalId,
        )
      ) {
        await this.client.dashboardCard.update({
          where: { id: card.id },
          data: {
            completedAt: new Date(),
            dismissedAt: null,
            snoozedUntil: null,
          },
        })
      }
    }
  }

  // Generates/reconciles cards for a single briefing from its artifact JSONB
  // (no S3 read). Upserts by stable identity so dismissals survive a re-run,
  // and removes cards for this briefing whose item is no longer featured.
  async syncFromBriefing(briefing: MeetingBriefing): Promise<void> {
    const desired = this.buildDesiredCards(briefing)
    // A successful parse always yields at least the briefing card, so an empty
    // list means the artifact failed to parse. Skip reconciliation entirely so
    // a transient bad artifact doesn't strand the briefing card while wiping
    // this briefing's agenda-item cards.
    if (!desired.length) return

    const electedOfficeId = briefing.electedOfficeId
    const sourceExternalId = briefing.id

    await this.client.$transaction(async (tx) => {
      for (const card of desired) {
        await this.upsertCard(tx, electedOfficeId, sourceExternalId, card)
      }
      await this.removeDeFeatured(
        tx,
        electedOfficeId,
        sourceExternalId,
        desired,
      )
    })
  }

  // Creates a single task card for a newly-surfaced community issue. Unlike
  // briefings there is nothing to reconcile — an issue is created once and never
  // de-featured — so this is a guarded create keyed on the issue id, idempotent
  // against at-least-once redelivery of the run-completed event.
  async syncFromCommunityIssue(
    electedOfficeId: string,
    issue: CommunityIssue,
  ): Promise<void> {
    const existing = await this.model.findFirst({
      where: {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: issue.id,
      },
      select: { id: true },
    })
    if (existing) return

    await this.model.create({
      data: {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: issue.id,
        sourceItemId: null,
        title: issue.title,
        summary: issue.summary,
        ctaLabel: 'View issue',
        ctaHref: `/dashboard/community-issues/${issue.id}`,
        dueDate: addDays(issue.createdAt, COMMUNITY_ISSUE_CARD_DUE_DAYS),
      },
    })
  }

  // The civic panel cards, created when the card list is read, so an
  // office that onboarded long ago gets them on its next visit: the office's
  // one build card, and a next-step card per open priority alongside it.
  async syncCivicPanelCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    // Read before the lock: it reads the people db, and reading the plan is
    // what moves it, so the card and the panel page agree.
    const panel = await this.readCivicPanelPlan(electedOffice)
    await this.client.$transaction(async (tx) => {
      // The home page and the archive read the list at once, and the build
      // card's null sourceItemId leaves the unique key unable to stop a
      // second insert.
      const lockKey = `civic_panel_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      await this.syncCivicPanelBuildCard(tx, electedOffice, panel)
      await this.syncCivicPanelStepCard(tx, electedOffice.id, panel)
      await this.syncPriorityPanelCards(tx, electedOffice.id)
    })
  }

  // Null when the plan could not be read; the card then keeps its words.
  private async readCivicPanelPlan(
    electedOffice: Pick<ElectedOffice, 'organizationSlug'>,
  ): Promise<CivicPanelBuildPlanResponse | null> {
    try {
      const organization = await this.client.organization.findUniqueOrThrow({
        where: { slug: electedOffice.organizationSlug },
      })
      // Looked up rather than injected: importing the contacts module here
      // closes a module cycle through voters, peerly and outreach.
      const plans = this.moduleRef.get(CivicPanelBuildPlanService, {
        strict: false,
      })
      return await plans.read(organization)
    } catch (err) {
      this.logger.warn(
        { err, organizationSlug: electedOffice.organizationSlug },
        'dashboard card sync: civic panel plan read failed',
      )
      return null
    }
  }

  // The build card has no Mark done: it is done once any sent text asked
  // people to JOIN, whichever purpose it went out under (the purpose is not
  // stored on the row, and the ask is what puts people on the panel), or
  // once the panel's plan reached its goal. Until then its words follow the
  // plan: the panel page's Next line, opening that step.
  private async syncCivicPanelBuildCard(
    tx: Prisma.TransactionClient,
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
    panel: CivicPanelBuildPlanResponse | null,
  ): Promise<void> {
    const where = {
      electedOfficeId: electedOffice.id,
      type: DashboardCardType.civic_panel,
      sourceExternalId: civicPanelBuildCardSourceId(electedOffice.id),
      sourceItemId: null,
    }
    const now = new Date()
    const content = panel
      ? civicPanelBuildCardContent(panel)
      : CIVIC_PANEL_BUILD_CARD_CONTENT
    const card =
      (await tx.dashboardCard.findFirst({ where })) ??
      (await tx.dashboardCard.create({
        data: {
          ...where,
          ...content,
          dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS),
        },
      }))
    // A done card reads as the card it was in the archive; an open one
    // follows the plan, and an unreadable plan leaves its words as they are.
    const differs = (words: typeof CIVIC_PANEL_BUILD_CARD_CONTENT) =>
      card.title !== words.title ||
      card.summary !== words.summary ||
      card.ctaLabel !== words.ctaLabel ||
      card.ctaHref !== words.ctaHref
    if (card.completedAt) {
      if (differs(CIVIC_PANEL_BUILD_CARD_CONTENT)) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: CIVIC_PANEL_BUILD_CARD_CONTENT,
        })
      }
      return
    }
    const stale = panel !== null && differs(content)

    const seedSent = await tx.outreach.findFirst({
      where: {
        organizationSlug: electedOffice.organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        asksToJoinCivicPanel: true,
        status: { notIn: UNSENT_OUTREACH_STATUSES },
      },
      select: { id: true },
    })
    const goalMet = panel?.plan?.status === 'completed'
    if (seedSent || goalMet) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...CIVIC_PANEL_BUILD_CARD_CONTENT,
          completedAt: now,
          dismissedAt: null,
          snoozedUntil: null,
        },
      })
      return
    }

    // It has no date of its own to miss, so it does not lapse into missed
    // while it is still open.
    const lapsed = !card.dismissedAt && card.dueDate < now
    if (stale || lapsed) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...(stale && content),
          ...(lapsed && { dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS) }),
        },
      })
    }
  }

  // Once the build card is done (its text is paid for), the plan's calls,
  // doors and later rounds would have no card on the home. So the plan's
  // ready step gets one: the panel page's Next line, opening that step. One
  // at a time, keyed by the step, so a skipped card stays skipped while its
  // step is next and the step after it gets its own. It goes once its step
  // is no longer next or ready (waiting on replies is not a step to take).
  // An unreadable plan leaves things as they are.
  private async syncCivicPanelStepCard(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    panel: CivicPanelBuildPlanResponse | null,
  ): Promise<void> {
    if (!panel) return
    const build = await tx.dashboardCard.findFirst({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: civicPanelBuildCardSourceId(electedOfficeId),
        sourceItemId: null,
      },
      select: { completedAt: true },
    })
    const next =
      build?.completedAt && panel.plan?.status === 'active' ? panel.next : null
    const ready = next?.stepId && next.href ? next.stepId : null
    const sourceExternalId = ready ? civicPanelStepCardSourceId(ready) : null
    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: {
          startsWith: CIVIC_PANEL_STEP_CARD_PREFIX,
          ...(sourceExternalId && { not: sourceExternalId }),
        },
      },
    })
    if (!sourceExternalId) return
    const content = civicPanelBuildCardContent(panel)
    const now = new Date()
    const card = await tx.dashboardCard.findFirst({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId,
      },
    })
    if (!card) {
      await tx.dashboardCard.create({
        data: {
          electedOfficeId,
          type: DashboardCardType.civic_panel,
          sourceExternalId,
          sourceItemId: null,
          ...content,
          dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS),
        },
      })
      return
    }
    const stale =
      card.title !== content.title ||
      card.summary !== content.summary ||
      card.ctaLabel !== content.ctaLabel ||
      card.ctaHref !== content.ctaHref
    const lapsed = !card.dismissedAt && card.dueDate < now
    if (stale || lapsed) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...content,
          ...(lapsed && { dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS) }),
        },
      })
    }
  }

  // One next-step card per priority with a step left to take. It goes once
  // the priority is archived or deleted, or its plan is ready, and comes back
  // if the priority is unarchived or a step comes open again. Its words follow
  // the priority's next step; a skipped or done card stays that way. It cannot
  // be done by hand, and does not lapse into missed, so there is always a
  // next step waiting.
  private async syncPriorityPanelCards(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
  ): Promise<void> {
    const open = await tx.priority.findMany({
      where: { electedOfficeId, archivedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        currentStep: true,
        nextAction: true,
      },
    })
    const openIds = open.map((priority) => priority.id)
    const priorities = open.filter((priority) => !isPlanReady(priority))
    const liveIds = priorities.map((priority) => priority.id)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: {
          notIn: [...openIds, civicPanelBuildCardSourceId(electedOfficeId)],
        },
        NOT: {
          sourceExternalId: { startsWith: CIVIC_PANEL_STEP_CARD_PREFIX },
        },
      },
    })
    // A ready plan takes the card off the home and out of the archive, the
    // same as archiving; a card the official marked done stays done.
    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        completedAt: null,
        sourceExternalId: {
          in: openIds.filter((id) => !liveIds.includes(id)),
        },
      },
    })
    const existing = await tx.dashboardCard.findMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: { in: liveIds },
      },
      select: {
        id: true,
        sourceExternalId: true,
        title: true,
        summary: true,
        ctaLabel: true,
        ctaHref: true,
        dueDate: true,
        dismissedAt: true,
        completedAt: true,
      },
    })
    const now = new Date()
    const dueDate = addDays(now, CIVIC_PANEL_CARD_DUE_DAYS)
    const byPriority = new Map(priorities.map((p) => [p.id, p]))
    for (const card of existing) {
      const priority = byPriority.get(card.sourceExternalId)
      if (!priority) continue
      const content = priorityNextStepCardContent(priority)
      const stale =
        card.title !== content.title ||
        card.summary !== content.summary ||
        card.ctaLabel !== content.ctaLabel ||
        card.ctaHref !== content.ctaHref
      const lapsed =
        !card.dismissedAt && !card.completedAt && card.dueDate < now
      if (stale || lapsed) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: { ...content, ...(lapsed && { dueDate }) },
        })
      }
    }
    const carded = new Set(existing.map((card) => card.sourceExternalId))
    const missing = priorities.filter((priority) => !carded.has(priority.id))
    if (missing.length === 0) return
    await tx.dashboardCard.createMany({
      data: missing.map((priority) => ({
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: priority.id,
        sourceItemId: null,
        ...priorityNextStepCardContent(priority),
        dueDate,
      })),
    })
  }

  private buildDesiredCards(briefing: MeetingBriefing): DesiredCard[] {
    const parsed = BriefingArtifactCardSourceSchema.safeParse(briefing.artifact)
    if (!parsed.success) {
      this.logger.warn(
        { briefingId: briefing.id },
        'dashboard card sync: briefing artifact missing card fields',
      )
      return []
    }

    const artifact = parsed.data
    const dateSlug = formatInTimeZone(briefing.meetingDate, 'UTC', 'yyyy-MM-dd')
    // dueDate is the instant the meeting day ends in the meeting's own
    // timezone, so a card stays active through the whole meeting day and the
    // active/missed split is a plain now() comparison. meetingDate is a
    // calendar date stored at UTC midnight; reinterpret it in the briefing's
    // timezone and take the end of that day.
    const dueDate = fromZonedTime(
      `${dateSlug}T23:59:59.999`,
      briefing.meetingTimezone || 'UTC',
    )
    const summary =
      artifact.executive_summary?.subheadline ??
      artifact.executive_summary?.headline ??
      artifact.executive_summary?.lead_in ??
      ''

    const briefingCard: DesiredCard = {
      type: DashboardCardType.briefing,
      sourceItemId: null,
      title: artifact.meeting_name ?? 'Your meeting briefing',
      summary,
      ctaLabel: 'Prepare for the meeting',
      ctaHref: briefingOverviewHref(dateSlug),
      dueDate,
    }

    const itemCards: DesiredCard[] = (
      artifact.executive_summary?.items ?? []
    ).map((item) => ({
      type: DashboardCardType.agenda_item,
      sourceItemId: item.item_id,
      title: item.title,
      summary: item.overview,
      ctaLabel: 'Learn more',
      ctaHref: briefingItemHref(dateSlug, item.item_id),
      dueDate,
    }))

    return [briefingCard, ...itemCards]
  }

  private async upsertCard(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    sourceExternalId: string,
    card: DesiredCard,
  ): Promise<void> {
    const content = {
      title: card.title,
      summary: card.summary,
      ctaLabel: card.ctaLabel,
      ctaHref: card.ctaHref,
      dueDate: card.dueDate,
    }

    const existing = await tx.dashboardCard.findFirst({
      where: {
        electedOfficeId,
        type: card.type,
        sourceExternalId,
        sourceItemId: card.sourceItemId,
      },
      select: { id: true },
    })

    // Only content fields change on update — dismissedAt is left untouched so
    // a dismissal survives regeneration.
    if (existing) {
      await tx.dashboardCard.update({
        where: { id: existing.id },
        data: content,
      })
      return
    }

    await tx.dashboardCard.create({
      data: {
        electedOfficeId,
        type: card.type,
        sourceExternalId,
        sourceItemId: card.sourceItemId,
        ...content,
      },
    })
  }

  private async removeDeFeatured(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    sourceExternalId: string,
    desired: DesiredCard[],
  ): Promise<void> {
    const keepItemIds = desired
      .filter((card) => card.type === DashboardCardType.agenda_item)
      .map((card) => card.sourceItemId)
      .filter((id): id is string => id !== null)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        sourceExternalId,
        type: DashboardCardType.agenda_item,
        sourceItemId: { notIn: keepItemIds },
      },
    })
  }

  async listByBucket(
    electedOfficeId: string,
    bucket: DashboardCardBucket,
    { includeCivicPanel = false }: { includeCivicPanel?: boolean } = {},
  ): Promise<DashboardCard[]> {
    return this.findMany({
      where: {
        ...this.bucketWhere(electedOfficeId, bucket),
        // Off, the panel cards an office already has stay out of every list.
        ...(!includeCivicPanel && {
          type: {
            notIn: [
              DashboardCardType.civic_panel,
              DashboardCardType.report_back,
            ],
          },
        }),
      },
      orderBy: { dueDate: Prisma.SortOrder.asc },
    })
  }

  private bucketWhere(
    electedOfficeId: string,
    bucket: DashboardCardBucket,
  ): Prisma.DashboardCardWhereInput {
    const now = new Date()
    switch (bucket) {
      case 'skipped':
        return { electedOfficeId, dismissedAt: { not: null } }
      case 'done':
        return { electedOfficeId, completedAt: { not: null } }
      case 'missed':
        return {
          electedOfficeId,
          dismissedAt: null,
          completedAt: null,
          dueDate: { lt: now },
        }
      case 'this_week':
        return {
          electedOfficeId,
          dueDate: {
            gte: startOfWeek(now),
            lte: endOfWeek(now),
          },
        }
      case 'active':
        return {
          electedOfficeId,
          dismissedAt: null,
          completedAt: null,
          dueDate: { gte: now },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        }
    }
  }

  async dismiss(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: null, completedAt: null },
      data: { dismissedAt: new Date() },
    })
  }

  // Civic panel cards finish on their own: the build card when its text
  // goes out, a priority card when its priority is resolved.
  async complete(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: {
        id,
        electedOfficeId,
        dismissedAt: null,
        completedAt: null,
        type: { not: DashboardCardType.civic_panel },
      },
      data: { completedAt: new Date(), snoozedUntil: null },
    })
  }

  // "Show in 3 days" moves the card's date with it, so it comes back due
  // rather than lapsing into missed while it is away.
  async snooze(electedOfficeId: string, id: string): Promise<void> {
    const until = addDays(new Date(), DASHBOARD_CARD_SNOOZE_DAYS)
    const open = { id, electedOfficeId, dismissedAt: null, completedAt: null }
    await this.client.$transaction([
      this.client.dashboardCard.updateMany({
        where: { ...open, dueDate: { lt: until } },
        data: { dueDate: until },
      }),
      this.client.dashboardCard.updateMany({
        where: open,
        data: { snoozedUntil: until },
      }),
    ])
  }

  // "Bring it back" undoes "Not for me".
  async restore(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: { not: null } },
      data: { dismissedAt: null, snoozedUntil: null },
    })
  }
}
