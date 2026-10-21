import { describe, expect, it } from 'vitest'
import {
  changeOrderKey,
  dmsTimestampToEpochMicros,
  mapDmsKinesisData,
  type ChangeRow,
} from './dmsRecord'

const DELIVERY = {
  kinesisSequenceNumber:
    '49650000000000000000000000000000000000000000000000000001',
  ingestedAt: Date.UTC(2026, 9, 21, 12, 0, 0) * 1000,
}
const LONG_PAYLOAD = 'x'.repeat(8192)

const kinesisData = (message: object): string =>
  Buffer.from(JSON.stringify(message, null, '\t')).toString('base64')

const metadata = (
  operation: string,
  table = 'replication_probe',
  recordType = 'data',
) => ({
  timestamp: '2026-10-21T12:00:00.000000Z',
  'record-type': recordType,
  operation,
  'partition-key-type': 'schema-table',
  'schema-name': 'public',
  'table-name': table,
  'transaction-id': 8812,
})

const headers = (changeSeq: string) => ({
  _dms_change_seq: changeSeq,
  _dms_commit_ts: changeSeq ? '2026-10-21 11:59:59.1234567' : '',
  _dms_stream_position: changeSeq ? '00000000/2316E0F8' : '',
})

const probeRow = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 7,
  payload: LONG_PAYLOAD,
  doc: JSON.stringify({ n }),
  updated_at: `2026-10-21 11:59:5${n}.123456`,
  ...extra,
})

const seqFor = (n: number) => `2026102111595900${String(n).padStart(19, '0')}`

const map = (message: object) =>
  mapDmsKinesisData(kinesisData(message), DELIVERY)

const changesOf = (message: object): ChangeRow[] => {
  const outcome = map(message)
  if (outcome.outcome !== 'changes') {
    throw new Error(`expected changes, got ${JSON.stringify(outcome)}`)
  }
  return outcome.changes
}

const currentState = (changes: ChangeRow[]) => {
  const latest = new Map<string, ChangeRow>()
  const carried = new Map<string, Record<string, unknown>>()
  for (const change of [...changes].sort((a, b) =>
    a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0,
  )) {
    const image = JSON.parse(change.row_image) as Record<string, unknown>
    const merged =
      change.op === 'update' ? { ...carried.get(change.pk), ...image } : image
    carried.set(change.pk, merged)
    latest.set(change.pk, change)
  }
  return new Map(
    [...latest].flatMap(([pk, change]) =>
      change.op === 'delete' ? [] : [[pk, carried.get(pk)] as const],
    ),
  )
}

describe('mapDmsKinesisData', () => {
  it('maps a CDC insert to one change row with the row image and DMS headers', () => {
    const [change] = changesOf({
      data: { ...probeRow(1), ...headers(seqFor(1)) },
      metadata: metadata('insert'),
    })
    expect(change).toEqual({
      source_schema: 'public',
      source_table: 'replication_probe',
      pk: '["7"]',
      op: 'insert',
      seq: `1${seqFor(1).padStart(40, '0')}`,
      change_seq: seqFor(1),
      stream_position: '00000000/2316E0F8',
      commit_ts: Date.UTC(2026, 9, 21, 11, 59, 59) * 1000 + 123456,
      transaction_id: '8812',
      row_image: JSON.stringify(probeRow(1)),
      unchanged_toast: [],
      kinesis_sequence_number: DELIVERY.kinesisSequenceNumber,
      ingested_at: DELIVERY.ingestedAt,
    })
  })

  it('maps a full-load row with seq 0 so every CDC change outranks it', () => {
    const [change] = changesOf({
      data: { ...probeRow(0), ...headers('') },
      metadata: metadata('load'),
    })
    expect(change).toMatchObject({
      op: 'load',
      seq: '0',
      change_seq: null,
      stream_position: null,
      commit_ts: null,
    })
  })

  it('maps a delete to a change row keyed by the deleted primary key', () => {
    const [change] = changesOf({
      data: { id: '7', ...headers(seqFor(3)) },
      metadata: metadata('delete'),
    })
    expect(change).toMatchObject({ op: 'delete', pk: '["7"]' })
  })

  it('accepts a primary key DMS sent as a string', () => {
    const [change] = changesOf({
      data: { ...probeRow(1, { id: '7' }), ...headers(seqFor(1)) },
      metadata: metadata('insert'),
    })
    expect(change?.pk).toBe('["7"]')
  })

  it('drops the unchanged-toast placeholder from an update and lists the column', () => {
    const [change] = changesOf({
      data: {
        ...probeRow(2, { payload: 'unchanged-toast-datum' }),
        ...headers(seqFor(2)),
      },
      metadata: metadata('update'),
    })
    expect(change?.unchanged_toast).toEqual(['payload'])
    expect(JSON.parse(change?.row_image ?? '{}')).not.toHaveProperty('payload')
  })

  it('keeps the placeholder text on an insert, where it can only be real data', () => {
    const [change] = changesOf({
      data: {
        ...probeRow(1, { payload: 'unchanged-toast-datum' }),
        ...headers(seqFor(1)),
      },
      metadata: metadata('insert'),
    })
    expect(change?.unchanged_toast).toEqual([])
    expect(JSON.parse(change?.row_image ?? '{}')).toHaveProperty(
      'payload',
      'unchanged-toast-datum',
    )
  })

  it('splits an update that changed the primary key into a delete of the old key and the new row', () => {
    const changes = changesOf({
      data: { ...probeRow(2, { id: 8 }), ...headers(seqFor(2)) },
      'before-image': { id: 7 },
      metadata: metadata('update'),
    })
    expect(changes.map((change) => [change.op, change.pk])).toEqual([
      ['delete', '["7"]'],
      ['update', '["8"]'],
    ])
  })

  it('keeps an update whose before image has the same primary key as one change', () => {
    const changes = changesOf({
      data: { ...probeRow(2), ...headers(seqFor(2)) },
      'before-image': { id: 7 },
      metadata: metadata('update'),
    })
    expect(changes).toHaveLength(1)
  })

  it('maps the real gp-api table the bench updates', () => {
    const [change] = changesOf({
      data: {
        id: 41,
        slug: 'poc-bench-synthetic',
        data: JSON.stringify({ pocBench: { n: 1 } }),
        updated_at: '2026-10-21 11:59:59.123456',
        ...headers(seqFor(4)),
      },
      metadata: metadata('update', 'campaign'),
    })
    expect(change).toMatchObject({ source_table: 'campaign', pk: '["41"]' })
  })

  it('reports a truncate on a mirrored table so the table can be reloaded', () => {
    expect(map({ data: {}, metadata: metadata('truncate') })).toEqual({
      outcome: 'truncate',
      table: 'replication_probe',
    })
  })

  it('reports DDL control records as DDL and other control records as control', () => {
    expect(
      map({ metadata: metadata('add-column', 'replication_probe', 'control') }),
    ).toEqual({
      outcome: 'control',
      operation: 'add-column',
      table: 'replication_probe',
      ddl: true,
    })
    expect(
      map({
        metadata: metadata('create-table', 'replication_probe', 'control'),
      }),
    ).toMatchObject({ outcome: 'control', ddl: false })
  })

  it('skips tables outside the mirrored list, including DMS heartbeat records', () => {
    expect(
      map({
        data: { id: 1, ...headers(seqFor(1)) },
        metadata: metadata('insert', 'awsdms_heartbeat'),
      }),
    ).toEqual({ outcome: 'other-table', table: 'public.awsdms_heartbeat' })
  })

  it('rejects a CDC change without a change sequence, since it cannot be ordered', () => {
    expect(
      map({
        data: { ...probeRow(1), ...headers('') },
        metadata: metadata('update'),
      }),
    ).toEqual({ outcome: 'malformed', reason: 'no change sequence' })
  })

  it('rejects a change without its primary key', () => {
    expect(
      map({
        data: { payload: 'x', ...headers(seqFor(1)) },
        metadata: metadata('insert'),
      }),
    ).toEqual({ outcome: 'malformed', reason: 'bad primary key (id)' })
  })

  it('rejects payloads that are not DMS JSON', () => {
    expect(
      mapDmsKinesisData(Buffer.from('nope').toString('base64'), DELIVERY),
    ).toEqual({ outcome: 'malformed', reason: 'not json' })
    expect(map({ data: probeRow(1) })).toEqual({
      outcome: 'malformed',
      reason: 'no metadata',
    })
  })
})

describe('change ordering', () => {
  it('orders full load below CDC and CDC changes numerically by change sequence', () => {
    const keys = [
      changeOrderKey('update', '20261021115959000000000000000000010'),
      changeOrderKey('load', null),
      changeOrderKey('update', '9'),
      changeOrderKey('insert', '20261021115959000000000000000000002'),
    ]
    expect([...keys].sort()).toEqual([keys[1], keys[2], keys[3], keys[0]])
  })

  it('rejects a change sequence that is not all digits', () => {
    expect(changeOrderKey('update', '0/2316E0F8')).toBeNull()
    expect(changeOrderKey('update', null)).toBeNull()
  })

  it('folds shuffled, duplicated changes into the latest state per key, deletes removed, TOAST carried forward', () => {
    const messages = [
      {
        data: { ...probeRow(0), ...headers('') },
        metadata: metadata('load'),
      },
      {
        data: {
          ...probeRow(1, { payload: 'unchanged-toast-datum' }),
          ...headers(seqFor(1)),
        },
        metadata: metadata('update'),
      },
      {
        data: {
          ...probeRow(2, { payload: 'unchanged-toast-datum' }),
          ...headers(seqFor(2)),
        },
        metadata: metadata('update'),
      },
      {
        data: { ...probeRow(1, { id: 9 }), ...headers(seqFor(3)) },
        metadata: metadata('insert'),
      },
      {
        data: { id: 9, ...headers(seqFor(4)) },
        metadata: metadata('delete'),
      },
      {
        data: { ...probeRow(5, { id: 10 }), ...headers(seqFor(5)) },
        metadata: metadata('insert'),
      },
    ]
    const changes = messages.flatMap(changesOf)
    const shuffledWithDuplicates = [
      changes[5],
      changes[2],
      changes[4],
      changes[2],
      changes[0],
      changes[3],
      changes[1],
      changes[5],
    ].filter((change): change is ChangeRow => change !== undefined)

    const state = currentState(shuffledWithDuplicates)

    expect([...state.keys()].sort()).toEqual(['["10"]', '["7"]'])
    expect(state.get('["7"]')).toEqual(probeRow(2))
    expect(state.get('["10"]')).toEqual(probeRow(5, { id: 10 }))
  })
})

describe('dmsTimestampToEpochMicros', () => {
  const expected = Date.UTC(2026, 9, 20, 17, 53, 11) * 1000 + 123456

  it('reads a DMS DATETIME with no zone as UTC', () => {
    expect(dmsTimestampToEpochMicros('2026-10-20 17:53:11.123456')).toBe(
      expected,
    )
  })

  it('reads ISO 8601 with Z or an offset, and DATETIME scale 7', () => {
    expect(dmsTimestampToEpochMicros('2026-10-20T17:53:11.123456Z')).toBe(
      expected,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20T19:53:11.123456+02:00')).toBe(
      expected,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20 17:53:11.1234567')).toBe(
      expected,
    )
  })

  it('returns null for text that is not a timestamp', () => {
    expect(dmsTimestampToEpochMicros('yesterday')).toBeNull()
  })
})
