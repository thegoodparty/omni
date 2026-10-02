import { Injectable } from '@nestjs/common'
import {
  FEEDBACK_SYNTHESIS_SOURCE_TYPE,
  type FeedbackSynthesisRequest,
} from '@goodparty_org/contracts'
import { formatISO } from 'date-fns'
import { Headers, Methods, MimeTypes } from 'http-constants-ts'
import {
  type FeedbackSynthesisRun,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type { SynthesisEngine, SynthesisMemo } from './synthesisEngine'

// Polls publish three groups. An effort's memos cover more ground, and the
// report ranks whatever comes back.
const PIPELINE_TOP_N = 10

const PIPELINE_TIMEOUT_MS = 30_000

// RFC 4180, every field quoted. Not csvEscape: that neutralizes spreadsheet
// formulas by prefixing a quote, which would rewrite a memo that starts with
// "-" before the pipeline ever reads it. Nobody opens this file in Excel.
const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`

const toCsv = (memos: SynthesisMemo[]) =>
  [
    'respondent_id,message_text,sent_at',
    ...memos.map((memo) =>
      [memo.id, memo.text, formatISO(memo.occurredAt)].map(csvField).join(','),
    ),
    '',
  ].join('\n')

// The polls synthesis pipeline (packages/gp-ai/serve/v1_pipeline), reused.
// It reads the CSV, groups, and later publishes `feedbackSynthesisComplete`
// on the shared queue, which the consumer hands to the ingest.
@Injectable()
export class PipelineSynthesisEngine
  extends createPrismaBase(MODELS.FeedbackSynthesisRun)
  implements SynthesisEngine
{
  readonly name = 'v1_pipeline'

  constructor(private readonly s3: S3Service) {
    super()
  }

  async start(
    run: FeedbackSynthesisRun,
    memos: SynthesisMemo[],
  ): Promise<void> {
    const error = await this.handOff(run, memos)
    if (error === null) return

    // Failed now rather than left for the sweep, so the report offers the
    // button again straight away and the previous run's themes stay up.
    await this.model.updateMany({
      where: { id: run.id, status: SynthesisRunStatus.running },
      data: { status: SynthesisRunStatus.failed, activeKey: null, error },
    })
  }

  // The reason the hand-off failed, or null when the pipeline took it.
  private async handOff(
    run: FeedbackSynthesisRun,
    memos: SynthesisMemo[],
  ): Promise<string | null> {
    const bucket = process.env.SERVE_ANALYSIS_BUCKET_NAME
    const baseUrl = process.env.AI_PIPELINE_BASE_URL
    const apiKey = process.env.AI_PIPELINE_API_KEY
    if (!bucket || !baseUrl || !apiKey) {
      this.logger.error(
        { runId: run.id },
        'Synthesis pipeline env is not configured',
      )
      return 'not configured'
    }

    // Not under `input/`: the bucket notifies the pipeline's trigger Lambda
    // on every `input/*.csv` and treats it as a poll, so a key there would
    // start each run twice, once as a poll. The POST below is the only
    // trigger.
    const key = `feedback-input/${run.id}.csv`
    const body: FeedbackSynthesisRequest = {
      sourceType: FEEDBACK_SYNTHESIS_SOURCE_TYPE,
      sourceId: run.id,
      csvS3Path: `s3://${bucket}/${key}`,
      topN: PIPELINE_TOP_N,
    }
    try {
      await this.s3.uploadFile(bucket, toCsv(memos), key, {
        contentType: 'text/csv',
      })
      const response = await fetch(`${baseUrl}/serve/messages/process`, {
        method: Methods.POST,
        headers: {
          [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS),
      })
      if (!response.ok) {
        this.logger.error(
          { runId: run.id, status: response.status },
          'Synthesis pipeline refused the run',
        )
        return `pipeline answered ${response.status}`
      }
    } catch (err) {
      this.logger.error({ err, runId: run.id }, 'Synthesis hand-off failed')
      return 'hand-off failed'
    }

    this.logger.info(
      { runId: run.id, inputCount: memos.length, csvS3Path: body.csvS3Path },
      'Synthesis run handed to the pipeline',
    )
    return null
  }
}
