import { Injectable } from '@nestjs/common'
import {
  OutreachHandoffApiStep,
  OutreachHandoffHandler,
  OutreachTextHandoff,
  Prisma,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { VENDOR_CRONS_ENABLED } from '@/shared/util/appEnvironment.util'
import { getUserFullName } from '@/users/util/users.util'
import { ScaleToWinApiError } from '@/vendors/scaleToWin/services/scaleToWinHttp.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { recordManagedPanelHandoffApiSteps } from '../observability/managedPanelHandoff.metrics'

// Dev and prod only, as the overdue sweep: every preview stack runs its own
// copy of the schedule, and all of them at once would drive one vendor
// account.
const SWEEP_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500

export type ApiHandoffRow = OutreachTextHandoff

type StepHandler = (row: ApiHandoffRow) => Promise<void>

type StepData = Omit<
  Prisma.OutreachTextHandoffUpdateManyMutationInput,
  'apiStep' | 'needsHumanAt' | 'needsHumanReason'
>

export type StopDetail = {
  // Scale to Win's own error code; the reason itself when omitted.
  errorCode?: string
  // One line for the person who picks the row up. Never a phone number or
  // reply text.
  cause?: string
  adminUrl?: string
}

// No response (a timeout, a dropped connection), a throttle or a server
// error may succeed on the next run, so the run fails and pg-boss retries.
const isTransient = (err: Error): boolean =>
  err instanceof ScaleToWinApiError &&
  (err.vendorStatus === undefined ||
    err.vendorStatus === HTTP_TOO_MANY_REQUESTS ||
    err.vendorStatus >= HTTP_SERVER_ERROR_MIN)

@Injectable()
export class S2wPanelWaveSweepService extends createPrismaBase(
  MODELS.OutreachTextHandoff,
) {
  constructor(
    private readonly slack: SlackService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // The s2wPanelWaveSweep schedule's worker, every 5 minutes. One step per
  // row per run, rows one at a time, so the whole account stays well under
  // Scale to Win's shared 60 requests a minute.
  async sweep(): Promise<void> {
    if (
      !SWEEP_DEPLOY_ENVIRONMENTS.has(process.env.OTEL_SERVICE_ENVIRONMENT ?? '')
    ) {
      return
    }
    // Dev reaches Scale to Win only through the vendor mock. Dev put back in
    // live mode (the VENDOR_MODE rollback lever) would call the real host, so
    // the sweep stays off there.
    if (!VENDOR_CRONS_ENABLED) return

    const rows = await this.model.findMany({
      where: {
        handler: OutreachHandoffHandler.api,
        apiStep: { not: OutreachHandoffApiStep.sent },
      },
      orderBy: [{ sendAt: Prisma.SortOrder.asc }, { id: Prisma.SortOrder.asc }],
    })
    const retry: string[] = []
    for (const row of rows) {
      if (row.needsHumanAt) {
        await this.watchNeedsHuman(row)
        continue
      }
      try {
        await this.advance(row)
      } catch (err) {
        // The 60 a minute limit is shared by the whole account, so a throttle
        // ends the run. A 5xx or timeout may belong to this row alone, so the
        // rows behind it still move.
        if (
          err instanceof ScaleToWinApiError &&
          err.vendorStatus === HTTP_TOO_MANY_REQUESTS
        ) {
          throw err
        }
        this.logger.warn(
          { err, handoffId: row.id, outreachId: row.outreachId },
          'Scale to Win panel wave step left to the retry',
        )
        retry.push(row.id)
      }
    }

    await this.recordStepCounts()
    if (retry.length > 0) {
      throw new Error(
        `Scale to Win sweep left hand-offs to the retry: ${retry.join(', ')}`,
      )
    }
  }

  async advance(row: ApiHandoffRow): Promise<void> {
    try {
      await this.runStep(row)
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught))
      if (isTransient(err)) throw err
      const code =
        err instanceof ScaleToWinApiError
          ? (err.code ?? String(err.vendorStatus))
          : 'error'
      this.logger.warn(
        { err, handoffId: row.id, outreachId: row.outreachId },
        'Scale to Win panel wave step failed',
      )
      await this.stop(row, `${row.apiStep}_${code}`, {
        errorCode: code,
        cause:
          err instanceof ScaleToWinApiError
            ? err.message
            : 'Unexpected error, see the gp-api logs',
      })
    }
  }

  /**
   * Moves a row one step, only if it is still at `from` and no person has it.
   * False means another run moved it first, so the caller does nothing more.
   */
  async transition(
    id: string,
    from: OutreachHandoffApiStep,
    to: OutreachHandoffApiStep,
    data: StepData = {},
  ): Promise<boolean> {
    const { count } = await this.model.updateMany({
      where: { id, apiStep: from, needsHumanAt: null },
      data: { ...data, apiStep: to },
    })
    return count === 1
  }

  /**
   * Hands a row to a person. Only the run whose write lands posts to Slack
   * and fires Wave Errored, so a row stopped twice is announced once. After
   * this the sweep only watches the row.
   */
  async stop(
    row: ApiHandoffRow,
    reason: string,
    { errorCode = reason, cause, adminUrl }: StopDetail = {},
  ): Promise<boolean> {
    // Read before the claim: a failed read after it would leave the row
    // stopped with no notice and no retry able to send one.
    const { outreach } = await this.model.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        outreach: {
          select: {
            organizationSlug: true,
            managedPanelWave: { select: { wave: true } },
            organization: {
              select: {
                owner: {
                  select: { firstName: true, lastName: true, name: true },
                },
              },
            },
          },
        },
      },
    })

    const { count } = await this.model.updateMany({
      where: { id: row.id, apiStep: row.apiStep, needsHumanAt: null },
      data: { needsHumanAt: new Date(), needsHumanReason: reason },
    })
    if (count === 0) return false

    const wave = outreach.managedPanelWave?.wave ?? null
    this.logger.warn(
      {
        handoffId: row.id,
        outreachId: row.outreachId,
        step: row.apiStep,
        reason,
      },
      'Scale to Win panel wave stopped for a person',
    )

    const owner = outreach.organization?.owner
    try {
      await this.announceApiStop({
        official: (owner && getUserFullName(owner)) || 'Unknown',
        outreachId: row.outreachId,
        wave,
        step: row.apiStep,
        reason,
        cause,
        adminUrl,
      })
    } catch (err) {
      this.logger.error(
        { err, handoffId: row.id },
        'Scale to Win stop notice failed',
      )
    }

    if (outreach.organizationSlug) {
      void trackForOffice(
        this.client,
        this.analytics,
        { organizationSlug: outreach.organizationSlug },
        [
          [
            EVENTS.Contacts.CivicPanelWaveErrored,
            { wave, handoff: 'api', step: row.apiStep, errorCode },
          ],
        ],
      )
    }
    return true
  }

  // Step bodies come in ENG-11748, ENG-11749 and ENG-11752. Each moves its
  // row only through transition() or stop().
  buildCampaign: StepHandler = () => Promise.resolve()

  loadContacts: StepHandler = () => Promise.resolve()

  checkLoad: StepHandler = () => Promise.resolve()

  afterCheck: StepHandler = () => Promise.resolve()

  checkStart: StepHandler = () => Promise.resolve()

  sendAtSlot: StepHandler = () => Promise.resolve()

  watchSend: StepHandler = () => Promise.resolve()

  // A person owns a stopped row, so this may only read Scale to Win (to
  // record a send they finish by hand), never write to it.
  watchNeedsHuman: StepHandler = () => Promise.resolve()

  private runStep(row: ApiHandoffRow): Promise<void> {
    switch (row.apiStep) {
      case OutreachHandoffApiStep.pending:
        return this.buildCampaign(row)
      case OutreachHandoffApiStep.created:
        return this.loadContacts(row)
      case OutreachHandoffApiStep.loading:
        return this.checkLoad(row)
      case OutreachHandoffApiStep.checked:
        return this.afterCheck(row)
      case OutreachHandoffApiStep.starting:
        return this.checkStart(row)
      case OutreachHandoffApiStep.ready:
        return this.sendAtSlot(row)
      case OutreachHandoffApiStep.sending:
        return this.watchSend(row)
      case OutreachHandoffApiStep.sent:
      case null:
        return Promise.resolve()
    }
  }

  private async recordStepCounts(): Promise<void> {
    const groups = await this.model.groupBy({
      by: ['apiStep'],
      where: { handler: OutreachHandoffHandler.api },
      _count: { _all: true },
    })
    const counts: Record<OutreachHandoffApiStep, number> = {
      pending: 0,
      created: 0,
      loading: 0,
      checked: 0,
      starting: 0,
      ready: 0,
      sending: 0,
      sent: 0,
    }
    for (const { apiStep, _count } of groups) {
      if (apiStep) counts[apiStep] = _count._all
    }
    recordManagedPanelHandoffApiSteps(counts)
  }

  // A standalone post, not a thread reply: the hand-off post's `ts` is not
  // stored.
  private async announceApiStop(notice: {
    official: string
    outreachId: number
    wave: number | null
    step: OutreachHandoffApiStep | null
    reason: string
    cause?: string
    adminUrl?: string
  }): Promise<void> {
    const lines = [
      `• Official: ${notice.official}`,
      `• Outreach: ${notice.outreachId}`,
      `• Wave: ${notice.wave ?? 'n/a'}`,
      `• Step: ${notice.step ?? 'n/a'}`,
      `• Reason: ${notice.reason}`,
      ...(notice.cause ? [`• Cause: ${notice.cause}`] : []),
      ...(notice.adminUrl ? [`• Campaign: ${notice.adminUrl}`] : []),
    ]
    await this.slack.message(
      {
        blocks: [
          {
            type: SlackMessageType.HEADER,
            text: {
              type: SlackMessageType.PLAIN_TEXT,
              text: 'Text wave stopped, needs a person',
              emoji: true,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text:
                'gp-api stopped building this wave through the Scale to ' +
                'Win API and will make no more changes to it. Check the ' +
                'campaign in Scale to Win, then finish it there or archive ' +
                'the draft.\n' +
                lines.join('\n'),
            },
          },
        ],
      },
      SlackChannel.botTevynApi,
    )
  }
}
