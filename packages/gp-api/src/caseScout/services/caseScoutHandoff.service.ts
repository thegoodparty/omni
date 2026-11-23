import { Injectable } from '@nestjs/common'
import { getUnixTime, isBefore, parseISO } from 'date-fns'
import { Headers, MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import {
  caseScoutBucketName,
  delegateWebhookSecret,
  delegateWebhookUrl,
  handoffEnvironment,
  sendsToDelegate,
} from '../caseScout.config'
import type {
  Bundle,
  Delivery,
  NewMarker,
  RunRecord,
  Sources,
} from '../schemas/caseScoutBucket.schema'
import {
  buildHandoff,
  handoffWebhookId,
  namesASourceId,
  signStandardWebhook,
} from '../util/handoff.util'
import { CaseScoutBucketService } from './caseScoutBucket.service'

const WEBHOOK_TIMEOUT_MS = 30_000

type Environment = 'dev' | 'prod'

// Hands the drafted night to the Delegate swarm, which writes the cases into
// the code-form suites and opens the PR. gp-api never holds a GitHub key.
// With CASE_SCOUT_SEND_TO_DELEGATE off the payload is only held in the bucket
// for a person to read. Either way the night's Slack note follows, then the
// marker moves.
//
// Safe to run again for a night: the payload is rebuilt from bundle.json, so
// it is the same bytes; a night whose delivery.json exists is never sent
// again; only the Slack note repeats.
@Injectable()
export class CaseScoutHandoffService {
  constructor(
    private readonly bucket: CaseScoutBucketService,
    private readonly slack: SlackService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaseScoutHandoffService.name)
  }

  async handOff(runId: string, signal: AbortSignal): Promise<void> {
    const [bundle, manifest, record, sources] = await Promise.all([
      this.bucket.readBundle(runId),
      this.bucket.readManifest(runId),
      this.bucket.readRecord(runId),
      this.bucket.readSources(runId),
    ])
    if (!bundle || !manifest || !record) {
      throw new Error(`case scout run ${runId} is missing its drafted files`)
    }
    const environment = handoffEnvironment()
    const body = JSON.stringify(buildHandoff(bundle, environment))
    if (namesASourceId(body, manifest)) {
      throw new Error(
        `case scout handoff for ${runId} names a source id; ` +
          'refusing to hold or send it',
      )
    }
    await this.bucket.writeHandoff(runId, body)

    const delivery = sendsToDelegate()
      ? await this.send(runId, environment, body, signal)
      : undefined
    await this.postNote({
      runId,
      environment,
      bundle,
      sources: sources ?? {},
      record,
      delivery,
    })
    await this.advanceMarker(runId, record.newMarker)
    this.logger.info(
      {
        runId,
        sent: delivery !== undefined,
        cases: bundle.drafts.length,
      },
      'Case scout night handed off',
    )
  }

  private async send(
    runId: string,
    environment: Environment,
    body: string,
    signal: AbortSignal,
  ): Promise<Delivery> {
    const earlier = await this.bucket.readDelivery(runId)
    if (earlier) return earlier

    const webhookId = handoffWebhookId(environment, runId)
    const timestamp = String(getUnixTime(new Date()))
    let response: Response
    try {
      response = await fetch(delegateWebhookUrl(), {
        method: 'POST',
        headers: {
          [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
          'webhook-id': webhookId,
          'webhook-timestamp': timestamp,
          'webhook-signature': signStandardWebhook({
            webhookId,
            timestamp,
            body,
            secret: delegateWebhookSecret(),
          }),
        },
        body,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        ]),
      })
    } catch (err) {
      // The error names the host, and the webhook URL is a secret: say only
      // what kind of failure it was.
      const kind = err instanceof Error ? err.name : 'unknown error'
      throw new Error(
        `case scout handoff for ${runId} could not reach the Delegate ` +
          `webhook (${kind})`,
      )
    }
    await response.body?.cancel()
    // Throwing retries the job and, on the last attempt, dead-letters it,
    // which pages.
    if (!response.ok) {
      throw new Error(
        `case scout handoff for ${runId} was refused by the Delegate ` +
          `webhook with HTTP ${response.status}`,
      )
    }
    const delivery: Delivery = {
      runId,
      webhookId,
      sentAt: new Date().toISOString(),
      status: response.status,
    }
    await this.bucket.writeDelivery(delivery)
    return delivery
  }

  // The one surface with the source conversation ids, for engineers: Slack is
  // internal. The handoff never carries them.
  private async postNote({
    runId,
    environment,
    bundle,
    sources,
    record,
    delivery,
  }: {
    runId: string
    environment: Environment
    bundle: Bundle
    sources: Sources
    record: RunRecord
    delivery: Delivery | undefined
  }): Promise<void> {
    const monthSpend = (
      await this.bucket.readMonthRecords(runId.slice(0, 7))
    ).reduce((total, night) => total + night.spendUsd.total, 0)
    const handoffKey = `${caseScoutBucketName()}/runs/${runId}/handoff.json`
    const handoffLine = delivery
      ? `Handoff: sent to Delegate (webhook-id ${delivery.webhookId})`
      : `Handoff: held at ${handoffKey} (CASE_SCOUT_SEND_TO_DELEGATE is off)`
    const conversationIds = bundle.drafts.map(
      ({ case: drafted }) =>
        sources[drafted.caseId]?.conversationId ?? 'unknown',
    )
    const caseLines = bundle.drafts.map(
      ({ agentId, severity, case: drafted }, index) =>
        `- \`${drafted.caseId}\` (${agentId}, severity ${severity}), ` +
        `conversation \`${conversationIds[index]}\``,
    )
    const table =
      environment === 'prod'
        ? 'gp_api_pg.public.agent_message'
        : 'gp_api_pg_dev.public.agent_message'
    const query =
      conversationIds.length > 0
        ? `SELECT * FROM ${table} WHERE conversation_id IN ` +
          `(${conversationIds.map((id) => `'${id}'`).join(', ')}) ` +
          'ORDER BY conversation_id, `index`'
        : `-- no cases tonight; nothing to query from ${table}`
    const { counts, spendUsd } = record
    const text = [
      `*Case scout, ${runId}*`,
      handoffLine,
      '',
      'Cases:',
      ...(caseLines.length > 0 ? caseLines : ['(none)']),
      '',
      'Databricks query:',
      `\`\`\`${query}\`\`\``,
      '',
      `Counts: covered=${counts.covered}, needsSetup=${counts.needsSetup}, ` +
        `gated=${counts.gated}, capped=${counts.capped}, ` +
        `listFull=${counts.listFull}`,
      `Spend: tonight $${spendUsd.total.toFixed(2)}, ` +
        `month to date $${monthSpend.toFixed(2)}`,
    ].join('\n')

    const posted = await this.slack.message(
      { text },
      environment === 'prod'
        ? SlackChannel.productChatsDigest
        : SlackChannel.botDev,
    )
    // As with a failed send: the marker waits, and the retry posts again.
    if (posted === undefined) {
      throw new Error(`case scout Slack note for ${runId} was not posted`)
    }
  }

  private async advanceMarker(
    runId: string,
    newMarker: NewMarker,
  ): Promise<void> {
    const marker = await this.bucket.readMarker()
    if (marker.updatedByRun === runId) return
    // A late retry of an older night must never drag the marker back: that
    // widens the next read and re-surfaces sessions already handled.
    const current = marker.lastSessionStart
    const next = newMarker.lastSessionStart
    if (current && next && isBefore(parseISO(next), parseISO(current))) {
      throw new Error(
        `case scout run ${runId} would move the marker backwards; ` +
          'leaving it where it is',
      )
    }
    await this.bucket.writeMarker({ ...newMarker, updatedByRun: runId })
  }
}
