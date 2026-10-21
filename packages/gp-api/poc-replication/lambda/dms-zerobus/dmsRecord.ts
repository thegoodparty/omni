import { z } from 'zod'
import { MIRRORED_TABLES, SOURCE_SCHEMA } from './mirroredTables'

export type ChangeOp = 'load' | 'insert' | 'update' | 'delete'

export type ChangeRow = {
  source_schema: string
  source_table: string
  pk: string
  op: ChangeOp
  seq: string
  change_seq: string | null
  stream_position: string | null
  commit_ts: number | null
  transaction_id: string | null
  row_image: string
  unchanged_toast: string[]
  kinesis_sequence_number: string
  ingested_at: number
}

export type DmsRecordOutcome =
  | { outcome: 'changes'; changes: ChangeRow[] }
  | {
      outcome: 'control'
      operation: string
      table: string | null
      ddl: boolean
    }
  | { outcome: 'truncate'; table: string }
  | { outcome: 'other-table'; table: string }
  | { outcome: 'malformed'; reason: string }

// test_decoding prints this for a TOASTed column an UPDATE left unchanged
// (checked on PostgreSQL 17, with REPLICA IDENTITY FULL too). DMS may pass it
// through, drop the column or send null; the first two are handled here and
// in the view, null is not (README, TOAST).
export const UNCHANGED_TOAST_PLACEHOLDER = 'unchanged-toast-datum'

// Columns the DMS table mapping adds to every record from the source headers
// $AR_H_CHANGE_SEQ, $AR_H_COMMIT_TIMESTAMP and $AR_H_STREAM_POSITION. All
// three are empty strings during full load.
export const DMS_HEADER_COLUMNS = {
  changeSeq: '_dms_change_seq',
  commitTimestamp: '_dms_commit_ts',
  streamPosition: '_dms_stream_position',
}

const DDL_OPERATIONS = new Set([
  'rename-table',
  'drop-table',
  'change-columns',
  'add-column',
  'drop-column',
  'rename-column',
  'column-type-change',
])

const TRUNCATE_OPERATIONS = new Set(['truncate', 'truncate-table'])

const CHANGE_OPERATIONS = new Set<string>([
  'load',
  'insert',
  'update',
  'delete',
])

const dmsMessageSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  'before-image': z.record(z.string(), z.unknown()).nullish(),
  metadata: z.object({
    'record-type': z.string(),
    operation: z.string(),
    'schema-name': z.string().nullish(),
    'table-name': z.string().nullish(),
    'transaction-id': z.union([z.string(), z.number()]).nullish(),
  }),
})

const DMS_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)?$/

// DMS writes timestamps as a DATETIME with no zone (UTC) or as ISO 8601.
// Zerobus takes TIMESTAMP as epoch microseconds.
export const dmsTimestampToEpochMicros = (text: string): number | null => {
  const match = DMS_TIMESTAMP.exec(text.trim())
  if (!match) return null
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction,
    offsetSign,
    offsetHours,
    offsetMins,
  ] = match
  const millis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  const offsetMinutes =
    (offsetSign === '-' ? -1 : 1) *
    (Number(offsetHours ?? 0) * 60 + Number(offsetMins ?? 0))
  const micros = Number((fraction ?? '').padEnd(6, '0').slice(0, 6))
  return (millis - offsetMinutes * 60_000) * 1000 + micros
}

// The current-state views keep the change with the highest seq per primary
// key. Full-load rows sort below every CDC change ('0' < '1...'), since DMS
// sends the changes made during a table's load after the load itself. CDC
// changes sort by $AR_H_CHANGE_SEQ, left-padded so string order is numeric
// order.
export const changeOrderKey = (
  op: ChangeOp,
  changeSeq: string | null,
): string | null => {
  if (op === 'load') return '0'
  if (!changeSeq || !/^\d{1,40}$/.test(changeSeq)) return null
  return `1${changeSeq.padStart(40, '0')}`
}

const primaryKey = (
  image: Record<string, unknown>,
  columns: string[],
): string | null => {
  const values: string[] = []
  for (const column of columns) {
    const value = image[column]
    if (typeof value === 'string' && value !== '') values.push(value)
    else if (typeof value === 'number' && Number.isInteger(value))
      values.push(String(value))
    else return null
  }
  return JSON.stringify(values)
}

const headerText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

export const mapDmsKinesisData = (
  base64Data: string,
  delivery: { kinesisSequenceNumber: string; ingestedAt: number },
): DmsRecordOutcome => {
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'))
  } catch {
    return { outcome: 'malformed', reason: 'not json' }
  }
  const message = dmsMessageSchema.safeParse(json)
  if (!message.success) return { outcome: 'malformed', reason: 'no metadata' }
  const { metadata, data } = message.data
  const schema = metadata['schema-name'] ?? null
  const table = metadata['table-name'] ?? null
  const pkColumns =
    schema === SOURCE_SCHEMA && table ? MIRRORED_TABLES[table] : undefined

  if (TRUNCATE_OPERATIONS.has(metadata.operation) && pkColumns && table) {
    return { outcome: 'truncate', table }
  }
  if (metadata['record-type'] === 'control') {
    return {
      outcome: 'control',
      operation: metadata.operation,
      table,
      ddl: DDL_OPERATIONS.has(metadata.operation),
    }
  }
  if (!pkColumns || !table) {
    return { outcome: 'other-table', table: `${schema ?? ''}.${table ?? ''}` }
  }
  if (!CHANGE_OPERATIONS.has(metadata.operation)) {
    return {
      outcome: 'malformed',
      reason: `unknown operation ${metadata.operation}`,
    }
  }
  const op = metadata.operation as ChangeOp
  if (!data) return { outcome: 'malformed', reason: 'no data' }

  const changeSeq = headerText(data[DMS_HEADER_COLUMNS.changeSeq])
  const commitTimestamp = headerText(data[DMS_HEADER_COLUMNS.commitTimestamp])
  const image: Record<string, unknown> = {}
  const unchangedToast: string[] = []
  for (const [column, value] of Object.entries(data)) {
    if (column.startsWith('_dms_')) continue
    if (op === 'update' && value === UNCHANGED_TOAST_PLACEHOLDER) {
      unchangedToast.push(column)
      continue
    }
    image[column] = value
  }

  const pk = primaryKey(image, pkColumns)
  if (pk === null) {
    return {
      outcome: 'malformed',
      reason: `bad primary key (${pkColumns.join(', ')})`,
    }
  }
  const seq = changeOrderKey(op, changeSeq)
  if (seq === null) {
    return { outcome: 'malformed', reason: 'no change sequence' }
  }
  const transactionId = metadata['transaction-id']
  const change: ChangeRow = {
    source_schema: SOURCE_SCHEMA,
    source_table: table,
    pk,
    op,
    seq,
    change_seq: changeSeq,
    stream_position: headerText(data[DMS_HEADER_COLUMNS.streamPosition]),
    commit_ts: commitTimestamp
      ? dmsTimestampToEpochMicros(commitTimestamp)
      : null,
    transaction_id:
      transactionId === null || transactionId === undefined
        ? null
        : String(transactionId),
    row_image: JSON.stringify(image),
    unchanged_toast: unchangedToast,
    kinesis_sequence_number: delivery.kinesisSequenceNumber,
    ingested_at: delivery.ingestedAt,
  }

  const before = message.data['before-image']
  const beforePk =
    op === 'update' && before ? primaryKey(before, pkColumns) : null
  if (beforePk && beforePk !== pk) {
    return {
      outcome: 'changes',
      changes: [
        {
          ...change,
          pk: beforePk,
          op: 'delete',
          row_image: JSON.stringify(before),
          unchanged_toast: [],
        },
        change,
      ],
    }
  }
  return { outcome: 'changes', changes: [change] }
}
