import { describe, expect, it } from 'vitest'
import {
  DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS,
  DOOR_KNOCKING_UNIT_KEY_COLUMNS,
  HOUSEHOLD_KEY_RESIDENCE_COLUMNS,
} from '@goodparty_org/contracts'
import { filtersSchema } from '../schemas/filters.schema'
import {
  buildDoorKnockingEvaluateSql,
  buildDoorKnockingResidentsSql,
  buildPackSql,
  PACK_CSV_COLUMNS,
  type DbxDistrict,
} from './databricksVoterSql.util'

const CITY: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'IL',
  districtType: 'City',
  districtName: 'SPRINGFIELD',
  useVoterOnlyPath: false,
}

const STATEWIDE: DbxDistrict = {
  districtId: 'aaaaaaaa-0000-0000-0000-000000000000',
  state: 'IL',
  districtType: 'State',
  districtName: 'IL',
  useVoterOnlyPath: true,
}

const EMPTY_FILTERS = filtersSchema.parse({})

const BBOX = { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 }

const CURRENT_KEY = '1200 W ELM ST|4B|62704'
const LEGACY_KEY = '1200||ELM||| |62704'

const valueOf = (
  params: Array<{ name: string; value: string | null }>,
  marker: string,
): string | null =>
  params.find((param) => `:${param.name}` === marker)?.value ?? null

const boundValues = (params: Array<{ value: string | null }>) =>
  params.map((param) => param.value)

describe('buildDoorKnockingEvaluateSql', () => {
  const build = (overrides = {}) =>
    buildDoorKnockingEvaluateSql({
      district: CITY,
      filters: EMPTY_FILTERS,
      bbox: BBOX,
      maxPeople: 20_000,
      ...overrides,
    })

  it('gates on rooftop geocoding, matching the Postgres quality gate', () => {
    expect(build().sql).toContain(
      "`Residence_Addresses_LatLongAccuracy` = 'GeoMatchRooftop'",
    )
  })

  it('casts the text coordinate columns and binds every bbox edge', () => {
    const { sql, params } = build()
    expect(sql).toContain('CAST(v.`Residence_Addresses_Latitude` AS DOUBLE)')
    expect(sql).toContain('CAST(v.`Residence_Addresses_Longitude` AS DOUBLE)')
    expect(boundValues(params)).toEqual(
      expect.arrayContaining(['41.8', '41.9', '-87.7', '-87.6']),
    )
  })

  it('detects overflow with LIMIT cap + 1 rather than counting', () => {
    const { sql, params } = build({ maxPeople: 20_000 })
    const marker = /LIMIT (:p\d+)$/.exec(sql.trim())?.[1] ?? ''
    expect(valueOf(params, marker)).toBe('20001')
  })

  it('composes the address key from the contracts unit columns', () => {
    const { sql } = build()
    for (const column of DOOR_KNOCKING_UNIT_KEY_COLUMNS) {
      expect(sql).toContain(`upper(trim(coalesce(cast(v.\`${column}\``)
    }
  })

  it('inlines the suppression id set and omits the clause when empty', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(build({ excludePersonIds: [id] }).sql).toContain(
      `v.\`id\` NOT IN ('${id}')`,
    )
    expect(build().sql).not.toContain('NOT IN')
  })

  it('refuses to inline a non-uuid into the suppression set', () => {
    expect(() => build({ excludePersonIds: ["' OR 1=1 --"] })).toThrow(
      /non-uuid/,
    )
  })

  it('drops the district predicate on the statewide path', () => {
    const { sql } = buildDoorKnockingEvaluateSql({
      district: STATEWIDE,
      filters: EMPTY_FILTERS,
      bbox: BBOX,
      maxPeople: 100,
    })
    expect(sql).toContain('v.`State` =')
    expect(sql).not.toContain('v.`State` = :p0 AND v.`State` =')
  })
})

describe('buildDoorKnockingResidentsSql', () => {
  const build = (addressKeys: string[]) =>
    buildDoorKnockingResidentsSql({
      district: CITY,
      addressKeys,
      residentsCap: 50,
    })

  it('binds address keys rather than inlining them', () => {
    const { sql, params } = build([CURRENT_KEY])
    expect(sql).not.toContain(CURRENT_KEY)
    expect(boundValues(params)).toContain(CURRENT_KEY)
  })

  // A route freezes all of its keys at once, so one request is entirely
  // current or entirely legacy. Compiling both key expressions would put a
  // second seven-column concat on every row of the scan for a branch that is
  // never taken.
  it('compiles only the current key expression for current-format keys', () => {
    const { sql } = build([CURRENT_KEY])
    expect(sql).toContain('Residence_Addresses_ApartmentNum')
    expect(sql).not.toContain('Residence_Addresses_HouseNumber')
  })

  it('compiles only the legacy key expression for legacy-format keys', () => {
    const { sql } = build([LEGACY_KEY])
    for (const column of DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS) {
      expect(sql).toContain(column)
    }
  })

  // The caller looks its own stored keys up in the result, so a legacy
  // request has to come back keyed the legacy way or every address misses.
  it('projects the same key format it matched on', () => {
    const legacy = build([LEGACY_KEY]).sql
    const projection = legacy.slice(legacy.lastIndexOf('AS `addressKey`') - 400)
    expect(projection).toContain('Residence_Addresses_HouseNumber')
  })

  it('ORs both expressions only when the keys are mixed', () => {
    const { sql } = build([CURRENT_KEY, LEGACY_KEY])
    expect(sql).toContain(' OR ')
    expect(sql).toContain('CASE WHEN')
  })

  it('casts key components to string so the INT direction columns coalesce', () => {
    // Residence_Addresses_PrefixDirection / _SuffixDirection are INT in the
    // mart, and Spark will not coalesce an INT with ''. Without the cast the
    // legacy key would fail to compile rather than produce the empty segment
    // Postgres produces.
    const { sql } = build([LEGACY_KEY])
    expect(sql).toContain(
      'coalesce(cast(v.`Residence_Addresses_PrefixDirection` AS STRING)',
    )
  })

  it('rejects rather than truncates, via LIMIT cap + 1', () => {
    const { sql, params } = build([CURRENT_KEY])
    const marker = /LIMIT (:p\d+)$/.exec(sql.trim())?.[1] ?? ''
    expect(valueOf(params, marker)).toBe('51')
  })
})

describe('buildPackSql', () => {
  it('selects every column the pack encoder reads, in order', () => {
    const { sql } = buildPackSql({ district: CITY })
    for (const column of PACK_CSV_COLUMNS) {
      expect(sql).toContain(`AS \`${column}\``)
    }
  })

  it('keys households by the same contracts columns as the CRM', () => {
    const { sql } = buildPackSql({ district: CITY })
    for (const column of HOUSEHOLD_KEY_RESIDENCE_COLUMNS) {
      expect(sql).toContain(column)
    }
  })

  // Nothing downstream can observe row order — the client walks the pack
  // positionally — and sorting a district is not free.
  it('does not order or limit the scan', () => {
    const { sql } = buildPackSql({ district: CITY })
    expect(sql).not.toContain('ORDER BY')
    expect(sql).not.toContain('LIMIT')
  })

  // Read back as CSV, where the API renders a SQL NULL as the literal text
  // `null`. Coalescing makes '' the unambiguous null case for the parser.
  it('coalesces nullable columns so CSV nulls are unambiguous', () => {
    const { sql } = buildPackSql({ district: CITY })
    expect(sql).toContain(
      "nvl(CAST(v.`Parties_Description` AS STRING), '') AS `Parties_Description`",
    )
  })

  it('drops rows whose coordinates do not cast, matching Postgres', () => {
    const { sql } = buildPackSql({ district: CITY })
    expect(sql).toContain(
      'CAST(v.`Residence_Addresses_Latitude` AS DOUBLE) IS NOT NULL',
    )
  })
})
