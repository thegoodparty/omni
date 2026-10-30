import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns'
import {
  CommunityIssue,
  DashboardCard,
  DashboardCardType,
  ElectedOffice,
  ManagedCivicPanelStatus,
  MeetingBriefing,
  Prisma,
  Priority,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  CIVIC_PANEL_PAGE_HREF,
  MANAGED_CIVIC_PANEL_CARD_CTA,
  managedCivicPanelCardContent,
  managedCivicPanelCardSourceId,
  managedCivicPanelProgressCardSourceId,
  MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA,
  MANAGED_CIVIC_PANEL_PROGRESS_CARD_CTA,
  type ManagedCivicPanel,
  type ManagedPanelProgressPhase,
  DASHBOARD_CARD_SNOOZE_DAYS,
  DashboardCardBucket,
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  READ_REPRESENTATIVENESS_LABELS,
  type PriorityReadStatus,
} from '@goodparty_org/contracts'
import { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import { shownNextAction } from '@/priorities/services/priorityStatus.service'
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
import { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'

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

type ManagedPanelRead = {
  panel: ManagedCivicPanel | null
  place: string | null
}

// The managed panel's offer card is stored without the place: the home
// draws its words with the office's place, which it knows without a
// district lookup.
type CardWords = {
  title: string
  summary: string
  ctaLabel: string
  ctaHref: string
}

export const MANAGED_CIVIC_PANEL_CARD_CONTENT: CardWords = {
  ...managedCivicPanelCardContent(null),
  ctaLabel: MANAGED_CIVIC_PANEL_CARD_CTA,
  ctaHref: CIVIC_PANEL_PAGE_HREF,
}

// How long the ready card stays on the home after the panel is ready.
export const MANAGED_PANEL_READY_CARD_DAYS = 14

// Which progress card an approved managed panel gets: a paused panel is
// still building. None once it is stopped, or its ready card has had its
// two weeks.
export const managedPanelPhase = (
  panel: Pick<ManagedCivicPanel, 'status' | 'readyAt'>,
  now: Date,
): ManagedPanelProgressPhase | null => {
  switch (panel.status) {
    case 'building':
    case 'paused':
      return 'building'
    case 'exhausted':
      return 'exhausted'
    case 'ready':
      return panel.readyAt &&
        addDays(panel.readyAt, MANAGED_PANEL_READY_CARD_DAYS) > now
        ? 'ready'
        : null
    case 'stopped':
      return null
  }
}

// The progress card's words. It shows the panel itself, so the count and
// the next send date are the item, the way a meeting card shows its date.
export const managedPanelProgressCardContent = (
  panel: Pick<ManagedCivicPanel, 'status' | 'progress'>,
  place: string | null = null,
): CardWords => {
  const { members, goalMembers, nextWaveAt } = panel.progress
  const joined = `${members} of ${goalMembers} residents have joined`
  const see = {
    ctaLabel: MANAGED_CIVIC_PANEL_PROGRESS_CARD_CTA,
    ctaHref: CIVIC_PANEL_PAGE_HREF,
  }
  if (panel.status === 'ready') {
    const hearFrom = place ? `all of ${place}` : 'your whole district'
    return {
      title: 'Your civic panel is ready',
      summary:
        `${members} residents said yes. Ask them what they think ` +
        `whenever you want to hear from ${hearFrom}.`,
      ...see,
    }
  }
  if (panel.status === 'exhausted') {
    return {
      title: 'Every resident we can text has an invite',
      summary: `${joined}. Door knocking and calls can reach the rest.`,
      ctaLabel: MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA,
      ctaHref: CIVIC_PANEL_PAGE_HREF,
    }
  }
  // Matches the civic panel page's paused lead card.
  if (panel.status === 'paused') {
    return {
      title: 'Your civic panel is paused',
      summary:
        members === 0
          ? 'Nobody has joined yet. Resume invites to start filling it.'
          : `${joined}. Resume invites to keep filling it.`,
      ...see,
    }
  }
  if (members === 0) {
    // Matches the civic panel page, which has not started filling at 0.
    return {
      title: 'Your civic panel starts here',
      summary: nextWaveAt
        ? `${joined}. More invites go out ${format(nextWaveAt, 'EEEE, MMMM d')}.`
        : `${joined} so far.`,
      ...see,
    }
  }
  const who = members === 1 ? 'resident is' : 'residents are'
  const ready = place
    ? `${members} ${place} ${who} ready to share their views`
    : `${members} ${who} ready to share their views`
  return {
    title: 'Your civic panel is filling up',
    summary: nextWaveAt
      ? `${ready}. More invites go out ${format(nextWaveAt, 'EEEE, MMMM d')}.`
      : `${ready}.`,
    ...see,
  }
}

const differsFrom = (card: CardWords, words: CardWords): boolean =>
  card.title !== words.title ||
  card.summary !== words.summary ||
  card.ctaLabel !== words.ctaLabel ||
  card.ctaHref !== words.ctaHref

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
        if (card.sourceItemId === null) return true
        const read = reads.get(card.sourceExternalId)
        // A priority with no read right now (replies being summarized) keeps
        // its card, and its snooze or dismiss.
        return read !== undefined && read.status !== card.sourceItemId
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
          // The first card a priority ever gets is already done when a report
          // back went out before it was made.
          const alreadyReported =
            !existing.some((c) => c.sourceExternalId === priorityId) &&
            (await this.reportBack.sentReportBack(
              electedOffice.organizationSlug,
              priorityId,
            )) !== null
          await tx.dashboardCard.create({
            data: {
              ...(alreadyReported && { completedAt: now }),
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
  // office that onboarded long ago gets them on its next visit: the managed
  // panel's cards, and a next-step card per open priority alongside them.
  async syncCivicPanelCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    // Read before the lock: it reads the people db.
    const managed = await this.readManagedCivicPanel(electedOffice)
    await this.client.$transaction(async (tx) => {
      // The home page and the archive read the list at once, and the managed
      // cards' null sourceItemId leaves the unique key unable to stop a
      // second insert.
      const lockKey = `civic_panel_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      await this.syncManagedCivicPanelCard(tx, electedOffice)
      await this.syncManagedPanelProgressCard(tx, electedOffice.id, managed)
      await this.syncPriorityPanelCards(tx, electedOffice.id)
    })
  }

  // Undefined when the enrollment could not be read; its card then stays as
  // it is.
  private async readManagedCivicPanel(
    electedOffice: Pick<ElectedOffice, 'organizationSlug'>,
  ): Promise<ManagedPanelRead | undefined> {
    try {
      const organization = await this.client.organization.findUniqueOrThrow({
        where: { slug: electedOffice.organizationSlug },
      })
      // Looked up rather than injected: importing the contacts module here
      // closes a module cycle through voters, peerly and outreach.
      const panels = this.moduleRef.get(ManagedCivicPanelService, {
        strict: false,
      })
      const { panel } = await panels.read(organization)
      // Only the filling-up card names the place, which takes a district
      // lookup.
      const place =
        panel?.status === 'building' && panel.progress.members > 0
          ? await panels.districtPlace(organization)
          : null
      return { panel, place }
    } catch (err) {
      this.logger.warn(
        { err, organizationSlug: electedOffice.organizationSlug },
        'dashboard card sync: managed civic panel read failed',
      )
      return undefined
    }
  }

  // The approved managed panel's one card at a time, keyed by its phase:
  // filling up (paused too), ready, or every resident a text can reach
  // invited. A card of another phase that is still open is deleted, so a
  // card set aside while building never hides the ready one. No Mark done;
  // the building and exhausted cards do not lapse, and the ready card goes
  // two weeks after the panel is ready.
  private async syncManagedPanelProgressCard(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    managed: ManagedPanelRead | undefined,
  ): Promise<void> {
    if (managed === undefined) return
    const { panel, place } = managed
    const now = new Date()
    const phase = panel ? managedPanelPhase(panel, now) : null
    const sourceExternalId =
      managedCivicPanelProgressCardSourceId(electedOfficeId)
    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId,
        completedAt: null,
        ...(phase && { NOT: { sourceItemId: phase } }),
      },
    })
    if (!panel || !phase) return
    const content = managedPanelProgressCardContent(panel, place)
    const dueDate =
      phase === 'ready' && panel.readyAt
        ? addDays(panel.readyAt, MANAGED_PANEL_READY_CARD_DAYS)
        : addDays(now, CIVIC_PANEL_CARD_DUE_DAYS)
    const where = {
      electedOfficeId,
      type: DashboardCardType.civic_panel,
      sourceExternalId,
      sourceItemId: phase,
    }
    const card = await tx.dashboardCard.findFirst({ where })
    if (!card) {
      await tx.dashboardCard.create({ data: { ...where, ...content, dueDate } })
      return
    }
    const lapsed = phase !== 'ready' && !card.dismissedAt && card.dueDate < now
    if (differsFrom(card, content) || lapsed) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: { ...content, ...(lapsed && { dueDate }) },
      })
    }
  }

  // The card that offers the managed panel: open until the office approves
  // one, then done. A stopped enrollment can be approved again, so its card
  // opens again, as the chat and the intro offer setup again. No Mark done, and it does not lapse
  // into missed while it is open. Old words are rewritten on the next read.
  private async syncManagedCivicPanelCard(
    tx: Prisma.TransactionClient,
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    const where = {
      electedOfficeId: electedOffice.id,
      type: DashboardCardType.civic_panel,
      sourceExternalId: managedCivicPanelCardSourceId(electedOffice.id),
      sourceItemId: null,
    }
    const now = new Date()
    const content = MANAGED_CIVIC_PANEL_CARD_CONTENT
    const [enrollment, card] = await Promise.all([
      tx.managedCivicPanel.findFirst({
        where: {
          organizationSlug: electedOffice.organizationSlug,
          status: { not: ManagedCivicPanelStatus.stopped },
        },
        select: { id: true },
      }),
      tx.dashboardCard.findFirst({ where }),
    ])
    if (enrollment) {
      if (card && !card.completedAt) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: { completedAt: now, dismissedAt: null, snoozedUntil: null },
        })
      }
      return
    }
    if (!card) {
      await tx.dashboardCard.create({
        data: {
          ...where,
          ...content,
          dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS),
        },
      })
      return
    }
    if (card.completedAt) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...content,
          completedAt: null,
          dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS),
        },
      })
      return
    }
    const stale = differsFrom(card, content)
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
    const official = await tx.electedOffice.findUnique({
      where: { id: electedOfficeId },
      select: { user: { select: { firstName: true, lastName: true } } },
    })
    const names = [official?.user?.firstName, official?.user?.lastName]
    const priorities = open
      .filter((priority) => !isPlanReady(priority))
      .map((priority) => ({
        ...priority,
        nextAction: shownNextAction(priority.nextAction, names),
      }))
    const liveIds = priorities.map((priority) => priority.id)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: {
          notIn: [
            ...openIds,
            managedCivicPanelCardSourceId(electedOfficeId),
            managedCivicPanelProgressCardSourceId(electedOfficeId),
          ],
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

  // Civic panel cards finish on their own: the managed cards as the panel
  // moves, a priority card when its priority is resolved.
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
