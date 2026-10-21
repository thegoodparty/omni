import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import type { KinesisStreamEvent } from 'aws-lambda'
import { z } from 'zod'
import {
  dmsTimestampToEpochMicros,
  mapDmsKinesisData,
  type ChangeRow,
} from './dmsRecord'
import { CANARY_TABLE } from './mirroredTables'

type ZerobusStream = {
  ingestRecordsOffset: (records: ChangeRow[]) => Promise<bigint | null>
  flush: () => Promise<void>
  close: () => Promise<void>
}

type ZerobusModule = {
  RecordType: { Json: number }
  ZerobusSdk: new (
    zerobusEndpoint: string,
    unityCatalogUrl: string,
    options?: { applicationName?: string },
  ) => {
    createStream: (
      tableProperties: { tableName: string },
      clientId: string,
      clientSecret: string,
      options?: { recordType?: number; recovery?: boolean },
    ) => Promise<ZerobusStream>
  }
}

// The Zerobus SDK ships a native binary per platform, so build.sh installs the
// linux-x64 build next to the bundle instead of the repo depending on it. The
// shape above is the slice of its index.d.ts this handler uses.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zerobus = require('@databricks/zerobus-ingest-sdk') as ZerobusModule

const env = z
  .object({
    ZEROBUS_SERVER_ENDPOINT: z.string().url(),
    DATABRICKS_WORKSPACE_URL: z.string().url(),
    ZEROBUS_TABLE_NAME: z.string().min(1),
    ZEROBUS_SECRET_ARN: z.string().min(1),
    METRICS_NAMESPACE: z.string().min(1),
    METRICS_PIPELINE: z.string().min(1),
  })
  .parse(process.env)

const zerobusSecretSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
})

const canaryImageSchema = z.object({ written_at: z.string() })

const secrets = new SecretsManagerClient({})

let streamPromise: Promise<ZerobusStream> | null = null

const zerobusStream = (): Promise<ZerobusStream> => {
  streamPromise ??= (async () => {
    const secret = await secrets.send(
      new GetSecretValueCommand({ SecretId: env.ZEROBUS_SECRET_ARN }),
    )
    const { client_id, client_secret } = zerobusSecretSchema.parse(
      JSON.parse(secret.SecretString ?? '{}'),
    )
    const sdk = new zerobus.ZerobusSdk(
      env.ZEROBUS_SERVER_ENDPOINT,
      env.DATABRICKS_WORKSPACE_URL,
      { applicationName: 'gp-poc-replication-dms/2' },
    )
    return sdk.createStream(
      { tableName: env.ZEROBUS_TABLE_NAME },
      client_id,
      client_secret,
      { recordType: zerobus.RecordType.Json, recovery: true },
    )
  })().catch((error: unknown) => {
    streamPromise = null
    throw error
  })
  return streamPromise
}

const writeChanges = async (changes: ChangeRow[]): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    const stream = await zerobusStream()
    try {
      await stream.ingestRecordsOffset(changes)
      await stream.flush()
      return
    } catch (error) {
      streamPromise = null
      await stream.close().catch(() => undefined)
      console.warn(
        JSON.stringify({
          msg: 'zerobus write failed',
          attempt,
          error: String(error),
        }),
      )
      // A stream left open while Lambda was frozen can be dead on the next
      // invocation; one reopen covers that. Anything else fails the batch so
      // Lambda retries it (at-least-once).
      if (attempt >= 2) throw error
    }
  }
}

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  const ingestedAt = Date.now() * 1000
  const changes: ChangeRow[] = []
  const counts = {
    DdlRecords: 0,
    ControlRecords: 0,
    TruncateRecords: 0,
    OtherTableRecords: 0,
    MalformedRecords: 0,
  }
  for (const record of event.Records) {
    const sequenceNumber = record.kinesis.sequenceNumber
    const result = mapDmsKinesisData(record.kinesis.data, {
      kinesisSequenceNumber: sequenceNumber,
      ingestedAt,
    })
    if (result.outcome === 'changes') {
      changes.push(...result.changes)
    } else if (result.outcome === 'truncate') {
      counts.TruncateRecords++
      console.error(
        JSON.stringify({
          msg: 'dms truncate: the current-state view still shows the old rows; reload the table (README, C reload)',
          table: result.table,
          sequenceNumber,
        }),
      )
    } else if (result.outcome === 'control') {
      counts[result.ddl ? 'DdlRecords' : 'ControlRecords']++
      console.warn(
        JSON.stringify({
          msg: result.ddl
            ? 'dms ddl record: regenerate the current-state views'
            : 'dms control record',
          operation: result.operation,
          table: result.table,
          sequenceNumber,
        }),
      )
    } else if (result.outcome === 'other-table') {
      counts.OtherTableRecords++
      console.info(
        JSON.stringify({
          msg: 'dms record for an unmirrored table skipped',
          table: result.table,
          sequenceNumber,
        }),
      )
    } else {
      counts.MalformedRecords++
      console.error(
        JSON.stringify({
          msg: 'dms record skipped: cannot map it to a change row',
          reason: result.reason,
          sequenceNumber,
        }),
      )
    }
  }

  if (changes.length > 0) await writeChanges(changes)

  const writtenAt = Date.now()
  const canaryLags = changes
    .filter((change) => change.source_table === CANARY_TABLE)
    .flatMap((change) => {
      const image = canaryImageSchema.safeParse(JSON.parse(change.row_image))
      const writtenUs = image.success
        ? dmsTimestampToEpochMicros(image.data.written_at)
        : null
      return writtenUs === null ? [] : [writtenAt - writtenUs / 1000]
    })
  const metrics: Record<string, number> = {
    ChangesWritten: changes.length,
    Updates: changes.filter((change) => change.op === 'update').length,
    Deletes: changes.filter((change) => change.op === 'delete').length,
    UnchangedToastColumns: changes.reduce(
      (sum, change) => sum + change.unchanged_toast.length,
      0,
    ),
    ...counts,
    CanaryChangesDelivered: canaryLags.length,
    ...(canaryLags.length > 0 ? { CanaryLagMs: Math.max(...canaryLags) } : {}),
  }
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: writtenAt,
        CloudWatchMetrics: [
          {
            Namespace: env.METRICS_NAMESPACE,
            Dimensions: [['Pipeline']],
            Metrics: Object.keys(metrics).map((name) => ({
              Name: name,
              Unit: name.endsWith('Ms') ? 'Milliseconds' : 'Count',
            })),
          },
        ],
      },
      Pipeline: env.METRICS_PIPELINE,
      ...metrics,
    }),
  )
}
