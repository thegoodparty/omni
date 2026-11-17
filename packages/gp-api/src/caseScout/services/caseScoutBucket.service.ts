import { Injectable } from '@nestjs/common'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { MimeTypes } from 'http-constants-ts'
import { z } from 'zod'
import { caseScoutBucketName } from '../caseScout.config'
import {
  BundleSchema,
  LedgerLineSchema,
  ManifestSchema,
  MarkerSchema,
  RecordSchema,
  SessionScoreSchema,
  SourcesSchema,
  type Bundle,
  type LedgerLine,
  type Manifest,
  type Marker,
  type RunRecord,
  type SessionScore,
  type Sources,
} from '../schemas/caseScoutBucket.schema'
import { parseLedgerText, type LedgerEntry } from '../util/ledger.util'

const AwsErrorSchema = z.object({
  $metadata: z.object({ httpStatusCode: z.number() }),
})

const S3_PRECONDITION_FAILED = 412
// S3 may answer a conditional write that races another with 409
// ConditionalRequestConflict rather than 412; both mean someone else won.
const S3_CONDITIONAL_CONFLICT = 409
const S3_NOT_FOUND = 404

const httpStatus = (err: Error): number | undefined =>
  AwsErrorSchema.safeParse(err).data?.$metadata.httpStatusCode

// The outcomes the draft job writes. A retry replaces its run's earlier lines
// of these kinds; the publisher's own lines are left alone.
const DRAFT_OUTCOMES = new Set<string>(LedgerLineSchema.shape.outcome.options)

// The scout's private bucket, case-scout-<env>. Layout and the publisher's
// half of the contract: src/caseScout/AGENTS.md § Bucket. Every write is
// validated against its schema first.
@Injectable()
export class CaseScoutBucketService {
  private readonly s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'us-west-2',
  })

  async getText(bucket: string, key: string): Promise<string | undefined> {
    try {
      const output = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
      return await output.Body?.transformToString('utf8')
    } catch (err) {
      if (err instanceof NoSuchKey) return undefined
      if (err instanceof Error && httpStatus(err) === S3_NOT_FOUND) {
        return undefined
      }
      throw err
    }
  }

  // Resolves false when `ifAbsent` is set and the key already exists.
  async putText(
    bucket: string,
    key: string,
    body: string,
    { ifAbsent = false }: { ifAbsent?: boolean } = {},
  ): Promise<boolean> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: MimeTypes.APPLICATION_JSON,
          ...(ifAbsent ? { IfNoneMatch: '*' } : {}),
        }),
      )
      return true
    } catch (err) {
      const status = err instanceof Error ? httpStatus(err) : undefined
      if (
        ifAbsent &&
        (status === S3_PRECONDITION_FAILED ||
          status === S3_CONDITIONAL_CONFLICT)
      ) {
        return false
      }
      throw err
    }
  }

  async listKeys(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key)
      }
      token = page.NextContinuationToken
    } while (token)
    return keys
  }

  private async readJson<T>(
    key: string,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> {
    const text = await this.getText(caseScoutBucketName(), key)
    return text === undefined ? undefined : schema.parse(JSON.parse(text))
  }

  private writeJson<T>(
    key: string,
    schema: z.ZodType<T>,
    value: T,
    options?: { ifAbsent?: boolean },
  ): Promise<boolean> {
    schema.parse(value)
    return this.putText(
      caseScoutBucketName(),
      key,
      JSON.stringify(value),
      options,
    )
  }

  // claims/<runDate> is the Lambda's night claim and claims/<runDate>.reader
  // the Python reader's; taking both keeps the old path from running a night
  // this one claimed. The body says who claimed it, so a retry of our own
  // nightly run can resume instead of finding the night taken.
  async claimNight(runId: string): Promise<'claimed' | 'ours' | 'taken'> {
    const bucket = caseScoutBucketName()
    const body = JSON.stringify({ claimedBy: 'gp-api' })
    const nightKey = `claims/${runId}`
    const readerKey = `claims/${runId}.reader`
    const wonNight = await this.putText(bucket, nightKey, body, {
      ifAbsent: true,
    })
    if (!wonNight && (await this.getText(bucket, nightKey)) !== body) {
      return 'taken'
    }
    const wonReader = await this.putText(bucket, readerKey, body, {
      ifAbsent: true,
    })
    if (!wonReader && (await this.getText(bucket, readerKey)) !== body) {
      return 'taken'
    }
    return wonNight ? 'claimed' : 'ours'
  }

  async readMarker(): Promise<Marker> {
    return (
      (await this.readJson('marker.json', MarkerSchema)) ?? {
        lastSessionStart: null,
        processedSessionIds: [],
        updatedByRun: null,
      }
    )
  }

  readManifest(runId: string): Promise<Manifest | undefined> {
    return this.readJson(`runs/${runId}/manifest.json`, ManifestSchema)
  }

  // Create-only, so two nightly attempts settle on one manifest.
  async createManifest(manifest: Manifest): Promise<Manifest> {
    const key = `runs/${manifest.runId}/manifest.json`
    const created = await this.writeJson(key, ManifestSchema, manifest, {
      ifAbsent: true,
    })
    if (created) return manifest
    const existing = await this.readManifest(manifest.runId)
    if (!existing) throw new Error(`${key} vanished after a lost create`)
    return existing
  }

  private scoreKey(runId: string, sessionId: string): string {
    return `runs/${runId}/scores/${sessionId}.json`
  }

  readScore(
    runId: string,
    sessionId: string,
  ): Promise<SessionScore | undefined> {
    return this.readJson(this.scoreKey(runId, sessionId), SessionScoreSchema)
  }

  async writeScore(score: SessionScore): Promise<void> {
    await this.writeJson(
      this.scoreKey(score.runId, score.sessionId),
      SessionScoreSchema,
      score,
      { ifAbsent: true },
    )
  }

  async readScores(runId: string): Promise<SessionScore[]> {
    const bucket = caseScoutBucketName()
    const keys = await this.listKeys(bucket, `runs/${runId}/scores/`)
    const texts = await Promise.all(
      keys.map((key) => this.getText(bucket, key)),
    )
    return texts.flatMap((text) =>
      text === undefined ? [] : [SessionScoreSchema.parse(JSON.parse(text))],
    )
  }

  readBundle(runId: string): Promise<Bundle | undefined> {
    return this.readJson(`runs/${runId}/bundle.json`, BundleSchema)
  }

  async writeBundle(bundle: Bundle): Promise<void> {
    await this.writeJson(
      `runs/${bundle.runId}/bundle.json`,
      BundleSchema,
      bundle,
    )
  }

  async writeSources(runId: string, sources: Sources): Promise<void> {
    await this.writeJson(`runs/${runId}/sources.json`, SourcesSchema, sources)
  }

  async writeRecord(record: RunRecord): Promise<void> {
    await this.writeJson(
      `runs/${record.runId}/record.json`,
      RecordSchema,
      record,
    )
  }

  async readLedgerEntries(months: string[]): Promise<LedgerEntry[]> {
    const bucket = caseScoutBucketName()
    const texts = await Promise.all(
      months.map((month) => this.getText(bucket, `ledger/${month}.jsonl`)),
    )
    return texts.flatMap((text) => (text ? parseLedgerText(text) : []))
  }

  // S3 has no append, so this is read-modify-write. Only the draft job writes
  // here, one night at a time, and the publisher runs after it returns. Lines
  // this run wrote on an earlier attempt are replaced, not doubled.
  async replaceRunLedgerLines(
    yyyymm: string,
    runId: string,
    lines: LedgerLine[],
  ): Promise<void> {
    for (const line of lines) LedgerLineSchema.parse(line)
    const bucket = caseScoutBucketName()
    const key = `ledger/${yyyymm}.jsonl`
    const existing = (await this.getText(bucket, key)) ?? ''
    const kept = existing.split('\n').filter((raw) => {
      if (raw.trim() === '') return false
      const entry = parseLedgerText(raw)[0]
      return !(entry?.runId === runId && DRAFT_OUTCOMES.has(entry.outcome))
    })
    const body = [...kept, ...lines.map((line) => JSON.stringify(line))]
    await this.putText(
      bucket,
      key,
      body.length > 0 ? `${body.join('\n')}\n` : '',
    )
  }
}
