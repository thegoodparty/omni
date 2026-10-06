import { Injectable } from '@nestjs/common'
import { formatISO } from 'date-fns'
import {
  type FeedbackSynthesisRun,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type { SynthesisEngine, SynthesisMemo } from './synthesisEngine'

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
    if (!bucket) {
      this.logger.error(
        { runId: run.id },
        'Synthesis pipeline bucket is not configured',
      )
      return 'not configured'
    }

    // Not under `input/`, which the trigger Lambda reads as a poll. Its
    // notification on `feedback-input/` starts the run as a memo run, with
    // the filename as the run id.
    const key = `feedback-input/${run.id}.csv`
    try {
      await this.s3.uploadFile(bucket, toCsv(memos), key, {
        contentType: 'text/csv',
      })
    } catch (err) {
      this.logger.error({ err, runId: run.id }, 'Synthesis hand-off failed')
      return 'hand-off failed'
    }

    this.logger.info(
      { runId: run.id, inputCount: memos.length, key },
      'Synthesis run handed to the pipeline',
    )
    return null
  }
}
