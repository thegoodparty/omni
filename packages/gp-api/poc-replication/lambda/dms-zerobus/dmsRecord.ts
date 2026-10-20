import { z } from 'zod'

export type OrgContactEventRow = {
  event_id: string
  org_slug: string
  person_id: string
  kind: string
  field: string | null
  value: string | null
  source: string
  import_id: string | null
  actor_user_id: number | null
  created_at: number
}

export type DmsRecordOutcome =
  | { outcome: 'row'; row: OrgContactEventRow }
  | { outcome: 'ignored-change'; operation: string; eventId: string | null }
  | {
      outcome: 'control'
      operation: string
      table: string | null
      ddl: boolean
    }
  | { outcome: 'other-table'; table: string }
  | { outcome: 'malformed'; reason: string }

const DDL_OPERATIONS = new Set([
  'rename-table',
  'drop-table',
  'change-columns',
  'add-column',
  'drop-column',
  'rename-column',
  'column-type-change',
])

const dmsMessageSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.object({
    'record-type': z.string(),
    operation: z.string(),
    'schema-name': z.string().nullish(),
    'table-name': z.string().nullish(),
  }),
})

const dmsRowSchema = z.object({
  event_id: z.string().min(1),
  org_slug: z.string().min(1),
  person_id: z.string().min(1),
  kind: z.string().min(1),
  field: z.string().nullish(),
  value: z.string().nullish(),
  source: z.string().min(1),
  import_id: z.string().nullish(),
  actor_user_id: z
    .union([
      z.number().int(),
      z
        .string()
        .regex(/^-?\d+$/)
        .transform(Number),
    ])
    .nullish(),
  created_at: z.string(),
})

const DMS_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)?$/

// DMS writes PostgreSQL timestamptz as a DATETIME with no zone (UTC) or as
// ISO 8601. Zerobus takes TIMESTAMP as epoch microseconds.
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

export const mapDmsKinesisData = (
  base64Data: string,
  source: { schema: string; table: string },
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
  const table = metadata['table-name'] ?? null
  if (metadata['record-type'] === 'control') {
    return {
      outcome: 'control',
      operation: metadata.operation,
      table,
      ddl: DDL_OPERATIONS.has(metadata.operation),
    }
  }
  if (metadata['schema-name'] !== source.schema || table !== source.table) {
    return {
      outcome: 'other-table',
      table: `${metadata['schema-name'] ?? ''}.${table ?? ''}`,
    }
  }
  if (metadata.operation !== 'insert' && metadata.operation !== 'load') {
    const eventId = data?.event_id
    return {
      outcome: 'ignored-change',
      operation: metadata.operation,
      eventId: typeof eventId === 'string' ? eventId : null,
    }
  }
  const row = dmsRowSchema.safeParse(data ?? {})
  if (!row.success) {
    return {
      outcome: 'malformed',
      reason: `bad row: ${row.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    }
  }
  const createdAt = dmsTimestampToEpochMicros(row.data.created_at)
  if (createdAt === null) {
    return { outcome: 'malformed', reason: 'bad row: created_at' }
  }
  return {
    outcome: 'row',
    row: {
      event_id: row.data.event_id,
      org_slug: row.data.org_slug,
      person_id: row.data.person_id,
      kind: row.data.kind,
      field: row.data.field ?? null,
      value: row.data.value ?? null,
      source: row.data.source,
      import_id: row.data.import_id ?? null,
      actor_user_id: row.data.actor_user_id ?? null,
      created_at: createdAt,
    },
  }
}
