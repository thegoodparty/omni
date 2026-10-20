import { describe, expect, it } from 'vitest'
import { dmsTimestampToEpochMicros, mapDmsKinesisData } from './dmsRecord'

const SOURCE = { schema: 'public', table: 'org_contact_event' }
const EVENT_ID = '0b6f1d6e-3c55-4f43-9a52-6f1c2b9d7e10'
const PERSON_ID = '5d2a9c1e-8f3b-4a6d-b7e2-1c9f0a4d3b21'
const CREATED_AT_MICROS = Date.UTC(2026, 9, 20, 17, 53, 11) * 1000 + 123456

const kinesisData = (message: object): string =>
  Buffer.from(JSON.stringify(message, null, '\t')).toString('base64')

const metadata = (operation: string, recordType = 'data') => ({
  timestamp: '2026-10-20T17:53:11.234567Z',
  'record-type': recordType,
  operation,
  'partition-key-type': 'primary-key',
  'schema-name': 'public',
  'table-name': 'org_contact_event',
  'transaction-id': 8812,
})

const syntheticRow = {
  event_id: EVENT_ID,
  org_slug: 'poc-dms-test',
  person_id: PERSON_ID,
  kind: 'set',
  field: 'email',
  value: 'testy.mcfake1@example.com',
  source: 'manual',
  import_id: null,
  actor_user_id: 7,
  created_at: '2026-10-20 17:53:11.123456',
}

describe('mapDmsKinesisData', () => {
  it('maps a CDC insert to a change-log row with created_at in epoch micros', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({ data: syntheticRow, metadata: metadata('insert') }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'row',
      row: {
        event_id: EVENT_ID,
        org_slug: 'poc-dms-test',
        person_id: PERSON_ID,
        kind: 'set',
        field: 'email',
        value: 'testy.mcfake1@example.com',
        source: 'manual',
        import_id: null,
        actor_user_id: 7,
        created_at: CREATED_AT_MICROS,
      },
    })
  })

  it('maps a full-load row the same as an insert, with omitted nulls as null', () => {
    const createWithNullsOmitted = {
      event_id: EVENT_ID,
      org_slug: 'poc-dms-test',
      person_id: PERSON_ID,
      kind: 'create',
      source: 'import',
      created_at: '2026-10-20 17:53:11.123456',
    }
    const outcome = mapDmsKinesisData(
      kinesisData({ data: createWithNullsOmitted, metadata: metadata('load') }),
      SOURCE,
    )
    expect(outcome).toMatchObject({
      outcome: 'row',
      row: {
        kind: 'create',
        field: null,
        value: null,
        import_id: null,
        actor_user_id: null,
      },
    })
  })

  it('accepts an integer actor_user_id that DMS sent as a string', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({
        data: { ...syntheticRow, actor_user_id: '42' },
        metadata: metadata('insert'),
      }),
      SOURCE,
    )
    expect(outcome).toMatchObject({
      outcome: 'row',
      row: { actor_user_id: 42 },
    })
  })

  it('ignores an update whose TOASTed value came through unchanged (null) and keeps its event id', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({
        data: { ...syntheticRow, value: null },
        metadata: metadata('update'),
        'before-image': { event_id: EVENT_ID },
      }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'ignored-change',
      operation: 'update',
      eventId: EVENT_ID,
    })
  })

  it('ignores an update where DMS dropped the unchanged TOAST column entirely', () => {
    const { value, ...withoutValue } = syntheticRow
    expect(value).toBeTruthy()
    const outcome = mapDmsKinesisData(
      kinesisData({ data: withoutValue, metadata: metadata('update') }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'ignored-change',
      operation: 'update',
      eventId: EVENT_ID,
    })
  })

  it('ignores a delete that only carries the primary key', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({
        data: { event_id: EVENT_ID },
        metadata: metadata('delete'),
      }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'ignored-change',
      operation: 'delete',
      eventId: EVENT_ID,
    })
  })

  it('ignores a truncate, which has no row data', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({ data: null, metadata: metadata('truncate') }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'ignored-change',
      operation: 'truncate',
      eventId: null,
    })
  })

  it('reports DDL control records (add-column) on the change-log table', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({
        control: {
          'table-def': { columns: { note: { type: 'WSTRING', length: 20 } } },
        },
        metadata: metadata('add-column', 'control'),
      }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'control',
      operation: 'add-column',
      table: 'org_contact_event',
      ddl: true,
    })
  })

  it('does not flag the create-table control record DMS sends when a full load starts as DDL', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({ metadata: metadata('create-table', 'control') }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'control',
      operation: 'create-table',
      table: 'org_contact_event',
      ddl: false,
    })
  })

  it('skips rows from any other table, such as the DMS DDL audit table', () => {
    const outcome = mapDmsKinesisData(
      kinesisData({
        data: { c_key: 1, c_tag: 'ALTER TABLE' },
        metadata: { ...metadata('insert'), 'table-name': 'awsdms_ddl_audit' },
      }),
      SOURCE,
    )
    expect(outcome).toEqual({
      outcome: 'other-table',
      table: 'public.awsdms_ddl_audit',
    })
  })

  it('reports payloads that are not JSON or have no DMS metadata as malformed', () => {
    expect(
      mapDmsKinesisData(Buffer.from('not json').toString('base64'), SOURCE),
    ).toEqual({ outcome: 'malformed', reason: 'not json' })
    expect(
      mapDmsKinesisData(kinesisData({ data: syntheticRow }), SOURCE),
    ).toEqual({ outcome: 'malformed', reason: 'no metadata' })
  })

  it('reports an insert missing a NOT NULL column as malformed instead of sending it to Zerobus', () => {
    const { org_slug, ...withoutOrg } = syntheticRow
    expect(org_slug).toBeTruthy()
    expect(
      mapDmsKinesisData(
        kinesisData({ data: withoutOrg, metadata: metadata('insert') }),
        SOURCE,
      ),
    ).toEqual({ outcome: 'malformed', reason: 'bad row: org_slug' })
    expect(
      mapDmsKinesisData(
        kinesisData({
          data: { ...syntheticRow, created_at: 'yesterday' },
          metadata: metadata('insert'),
        }),
        SOURCE,
      ),
    ).toEqual({ outcome: 'malformed', reason: 'bad row: created_at' })
  })
})

describe('dmsTimestampToEpochMicros', () => {
  it('reads a zoneless DMS DATETIME as UTC', () => {
    expect(dmsTimestampToEpochMicros('2026-10-20 17:53:11.123456')).toBe(
      CREATED_AT_MICROS,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20 17:53:11')).toBe(
      Date.UTC(2026, 9, 20, 17, 53, 11) * 1000,
    )
  })

  it('reads ISO 8601 with Z or an offset', () => {
    expect(dmsTimestampToEpochMicros('2026-10-20T17:53:11.123456Z')).toBe(
      CREATED_AT_MICROS,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20T19:53:11.123456+02:00')).toBe(
      CREATED_AT_MICROS,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20 12:23:11.123456-0530')).toBe(
      CREATED_AT_MICROS,
    )
    expect(dmsTimestampToEpochMicros('2026-10-20 19:53:11.123456+02')).toBe(
      CREATED_AT_MICROS,
    )
  })

  it('truncates nanoseconds to microseconds and rejects other text', () => {
    expect(dmsTimestampToEpochMicros('2026-10-20 17:53:11.123456789')).toBe(
      CREATED_AT_MICROS,
    )
    expect(dmsTimestampToEpochMicros('20/10/2026')).toBeNull()
  })
})
