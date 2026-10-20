import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import type { KinesisStreamEvent } from 'aws-lambda'
import { z } from 'zod'
import { mapDmsKinesisData, type OrgContactEventRow } from './dmsRecord'

type ZerobusStream = {
  ingestRecordsOffset: (records: OrgContactEventRow[]) => Promise<bigint | null>
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
    SOURCE_SCHEMA: z.string().min(1),
    SOURCE_TABLE: z.string().min(1),
    CANARY_SOURCE: z.string().min(1),
    METRICS_NAMESPACE: z.string().min(1),
    METRICS_PIPELINE: z.string().min(1),
  })
  .parse(process.env)

const zerobusSecretSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
})

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
      { applicationName: 'gp-poc-replication-dms/1' },
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

const writeRows = async (rows: OrgContactEventRow[]): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    const stream = await zerobusStream()
    try {
      await stream.ingestRecordsOffset(rows)
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
  const rows: OrgContactEventRow[] = []
  const counts = {
    IgnoredChanges: 0,
    DdlRecords: 0,
    ControlRecords: 0,
    OtherTableRecords: 0,
    MalformedRecords: 0,
  }
  for (const record of event.Records) {
    const sequenceNumber = record.kinesis.sequenceNumber
    const result = mapDmsKinesisData(record.kinesis.data, {
      schema: env.SOURCE_SCHEMA,
      table: env.SOURCE_TABLE,
    })
    if (result.outcome === 'row') {
      rows.push(result.row)
    } else if (result.outcome === 'ignored-change') {
      counts.IgnoredChanges++
      console.warn(
        JSON.stringify({
          msg: 'dms change ignored: the change log is append-only',
          operation: result.operation,
          eventId: result.eventId,
          sequenceNumber,
        }),
      )
    } else if (result.outcome === 'control') {
      counts[result.ddl ? 'DdlRecords' : 'ControlRecords']++
      console.warn(
        JSON.stringify({
          msg: result.ddl ? 'dms ddl record' : 'dms control record',
          operation: result.operation,
          table: result.table,
          sequenceNumber,
        }),
      )
    } else if (result.outcome === 'other-table') {
      counts.OtherTableRecords++
      console.info(
        JSON.stringify({
          msg: 'dms record for another table skipped',
          table: result.table,
          sequenceNumber,
        }),
      )
    } else {
      counts.MalformedRecords++
      console.error(
        JSON.stringify({
          msg: 'dms record skipped: cannot map it to a change-log row',
          reason: result.reason,
          sequenceNumber,
        }),
      )
    }
  }

  if (rows.length > 0) await writeRows(rows)

  const writtenAt = Date.now()
  const canaryLags = rows
    .filter((row) => row.source === env.CANARY_SOURCE)
    .map((row) => writtenAt - row.created_at / 1000)
  const metrics: Record<string, number> = {
    EventsWritten: rows.length,
    ...counts,
    CanaryEventsDelivered: canaryLags.length,
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
