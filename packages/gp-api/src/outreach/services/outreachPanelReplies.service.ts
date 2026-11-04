import { Injectable } from '@nestjs/common'
import { addHours } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { PanelRepliesUploadedEvent } from '@goodparty_org/contracts'
import {
  OutreachHandoffHandler,
  OutreachHandoffStatus,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { EVENTS } from '@/vendors/segment/segment.types'
import { checkResultsCsv } from '../util/outreachResultsCsv.util'
import { OutreachTextIngestService } from './outreachTextIngest.service'

const REPLIES_KEY = /^agent-replies\/([1-9]\d*)\.csv$/

// The agent wave's reply window, counted from its real first send. The manual
// path counts MANAGED_WAVE_REPLY_DAYS from the scheduled date instead.
const AGENT_REPLY_WINDOW_HOURS = 48

/**
 * An agent-handled wave's replies arriving: the swarm uploads the Scale to Win
 * export to `agent-replies/<outreachId>.csv` and S3 turns that into a
 * `panelRepliesUploaded` queue message. Ingests the replies, dates the wave's
 * reply window from the real send, records Wave Sent, and stamps the hand-off.
 *
 * Never claims the wave free or steps the panel: the daily wave job closes the
 * wave once its window has passed
 * (adr/2026-10-22-managed-panel-free-sends-and-guards). Every step is
 * idempotent, so a redelivered message or a re-upload changes nothing. Nothing
 * here may log a phone number or a reply body: the export is constituent data.
 */
@Injectable()
export class OutreachPanelRepliesService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly ingest: OutreachTextIngestService,
    private readonly slack: SlackService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async handleUpload({
    bucket,
    key,
  }: PanelRepliesUploadedEvent): Promise<void> {
    const match = REPLIES_KEY.exec(key)
    if (!match) {
      this.logger.warn({ key }, 'Panel replies upload with an unexpected key')
      return
    }
    const outreachId = Number(match[1])

    const outreach = await this.model.findUnique({
      where: { id: outreachId },
      select: {
        textCount: true,
        textHandoff: { select: { handler: true, timeZone: true } },
        managedPanelWave: {
          select: {
            id: true,
            wave: true,
            steeredToward: true,
            sentAt: true,
            enrollment: { select: { organizationSlug: true } },
          },
        },
      },
    })
    if (outreach?.textHandoff?.handler !== OutreachHandoffHandler.agent) {
      this.logger.warn(
        { outreachId },
        'Panel replies upload for an outreach the agent does not handle',
      )
      return
    }

    const csv = await this.s3.getFile(bucket, key)
    if (csv === undefined) {
      this.logger.warn({ outreachId, key }, 'Panel replies export is missing')
      return
    }
    const parsed = checkResultsCsv({ fileName: key, csv })
    if (!parsed.ok) {
      this.logger.error(
        { outreachId, key, reason: parsed.error },
        'Panel replies export is unreadable',
      )
      return
    }

    const result = await this.ingest.ingestReplies({
      outreachId,
      rows: parsed.rows,
      sourceLabel: 'delegate_swarm_agent',
    })
    this.logger.info(
      {
        outreachId,
        rowsParsed: result.rowsParsed,
        matched: result.matched,
        unmatched: result.unmatched,
        skippedRows: parsed.skipped.length,
        outboundRows: parsed.outboundRows,
      },
      'Panel replies export ingested',
    )

    const wave = outreach.managedPanelWave
    const sentAt = parsed.firstOutboundAt ?? wave?.sentAt ?? null
    if (wave && sentAt) {
      const { count } = await this.client.managedPanelWave.updateMany({
        where: { id: wave.id, replyWindowEndsAt: null },
        data: { replyWindowEndsAt: addHours(sentAt, AGENT_REPLY_WINDOW_HOURS) },
      })
      if (count > 0) {
        void trackForOffice(
          this.client,
          this.analytics,
          { organizationSlug: wave.enrollment.organizationSlug },
          [
            [
              EVENTS.Contacts.CivicPanelWaveSent,
              {
                wave: wave.wave,
                texts: outreach.textCount ?? 0,
                sendDate: formatInTimeZone(
                  sentAt,
                  outreach.textHandoff.timeZone,
                  'yyyy-MM-dd',
                ),
                steeredToward: wave.steeredToward,
                handoff: 'agent',
              },
            ],
          ],
        )
      }
    }

    await this.client.outreachTextHandoff.updateMany({
      where: { outreachId, status: OutreachHandoffStatus.queued },
      data: {
        status: OutreachHandoffStatus.replies_submitted,
        repliesSubmittedAt: new Date(),
      },
    })

    if (result.matched === 0) {
      await this.slack.message(
        {
          text: `The agent's reply export for outreach ${outreachId} matched no recipients. Check the file the swarm uploaded.`,
        },
        SlackChannel.botTevynApi,
      )
    }
  }
}
