import { HttpStatus, Injectable } from '@nestjs/common'
import {
  InvocationType,
  InvokeCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda'
import { PinoLogger } from 'nestjs-pino'
import { publisherFunctionName } from '../caseScout.config'
import {
  PublishBodySchema,
  PublishResponseSchema,
} from '../schemas/caseScoutBucket.schema'

// Statuses that mean the publish went through (lambda/handler.py).
const PUBLISHED_STATUSES = new Set(['published', 'dry_run'])

// Hands the night to the publisher Lambda, the only process that holds the
// GitHub App key; this one has read transcripts and must never hold it.
@Injectable()
export class CaseScoutPublisherService {
  // The read timeout sits above the Lambda's own 300s timeout, so the client
  // never gives up on an invocation that is still running. One attempt only:
  // RequestResponse has no idempotency token, so a client retry would start a
  // second publish of the same run beside the first.
  private readonly lambda = new LambdaClient({
    region: process.env.AWS_REGION ?? 'us-west-2',
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 310_000 },
  })

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(CaseScoutPublisherService.name)
  }

  async invoke(
    runId: string,
  ): Promise<{ functionError?: string; payload: string }> {
    const response = await this.lambda.send(
      new InvokeCommand({
        FunctionName: publisherFunctionName(),
        InvocationType: InvocationType.RequestResponse,
        Payload: Buffer.from(JSON.stringify({ action: 'publish', runId })),
      }),
    )
    return {
      functionError: response.FunctionError,
      payload: Buffer.from(response.Payload ?? []).toString('utf8'),
    }
  }

  async publish(runId: string): Promise<void> {
    const { functionError, payload } = await this.invoke(runId)
    if (functionError) {
      throw new Error(
        `case scout publish for ${runId} failed inside the function: ${payload}`,
      )
    }
    const { statusCode, body } = PublishResponseSchema.parse(
      JSON.parse(payload),
    )
    const { status, prUrl } = PublishBodySchema.parse(JSON.parse(body))
    // A failed publish leaves the marker where it was; throwing retries it
    // and, on the last attempt, dead-letters the job, which pages.
    if (
      statusCode !== Number(HttpStatus.OK) ||
      !PUBLISHED_STATUSES.has(status)
    ) {
      throw new Error(
        `case scout publish for ${runId} returned ${statusCode} ${status}`,
      )
    }
    this.logger.info({ runId, status, prUrl }, 'Case scout night published')
  }
}
