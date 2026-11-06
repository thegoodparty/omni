import { gunzipSync } from 'node:zlib'
import { z } from 'zod'

export enum SesEventType {
  Delivery = 'Delivery',
  Bounce = 'Bounce',
  Complaint = 'Complaint',
  Open = 'Open',
  Click = 'Click',
}

export type SesEvent = {
  type: SesEventType
  messageId: string
  timestamp: Date
  bounceType?: string
}

const timestamped = z.object({ timestamp: z.string().datetime() })

const SesEventRecordSchema = z.object({
  eventType: z.string(),
  mail: z.object({ messageId: z.string().min(1) }),
  delivery: timestamped.optional(),
  bounce: timestamped
    .extend({ bounceType: z.string().min(1).optional() })
    .optional(),
  complaint: timestamped.optional(),
  open: timestamped.optional(),
  click: timestamped.optional(),
})

type SesEventRecord = z.infer<typeof SesEventRecordSchema>

const timestampOf = (
  record: SesEventRecord,
  type: SesEventType,
): string | undefined => {
  switch (type) {
    case SesEventType.Delivery:
      return record.delivery?.timestamp
    case SesEventType.Bounce:
      return record.bounce?.timestamp
    case SesEventType.Complaint:
      return record.complaint?.timestamp
    case SesEventType.Open:
      return record.open?.timestamp
    case SesEventType.Click:
      return record.click?.timestamp
  }
}

const isSesEventType = (value: string): value is SesEventType =>
  Object.values<string>(SesEventType).includes(value)

const GZIP_MAGIC = [0x1f, 0x8b]

export const decodeEventFile = (bytes: Buffer): string =>
  bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
    ? gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8')

// Firehose writes SES records back to back, with or without a newline
// between them, so the file is split on top-level object boundaries rather
// than on lines.
export const splitJsonObjects = (text: string): string[] => {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = i
      depth++
    } else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0) objects.push(text.slice(start, i + 1))
    }
  }
  return objects
}

// A record that is not valid JSON is skipped, the same as one that fails the
// schema, and counted for the caller to log.
const parseRecord = (raw: string) => {
  try {
    return SesEventRecordSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}

type ParsedEventFile = { events: SesEvent[]; skipped: number }

export const parseEventFile = (bytes: Buffer): ParsedEventFile => {
  const events: SesEvent[] = []
  let skipped = 0
  for (const raw of splitJsonObjects(decodeEventFile(bytes))) {
    const parsed = parseRecord(raw)
    if (!parsed?.success || !isSesEventType(parsed.data.eventType)) {
      skipped++
      continue
    }
    const type = parsed.data.eventType
    const timestamp = timestampOf(parsed.data, type)
    if (!timestamp) {
      skipped++
      continue
    }
    events.push({
      type,
      messageId: parsed.data.mail.messageId,
      timestamp: new Date(timestamp),
      ...(type === SesEventType.Bounce && parsed.data.bounce?.bounceType
        ? { bounceType: parsed.data.bounce.bounceType }
        : {}),
    })
  }
  return { events, skipped }
}
