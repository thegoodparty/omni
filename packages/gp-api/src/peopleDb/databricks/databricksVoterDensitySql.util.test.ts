import { describe, expect, it } from 'vitest'
import {
  buildVoterDensityMetaSql,
  buildVoterDensitySql,
  mapVoterDensityCells,
  mapVoterDensityCoverage,
} from './databricksVoterDensitySql.util'

const DISTRICT_ID = '635757db-0000-0000-0000-000000000000'

describe('buildVoterDensitySql', () => {
  it('reads the precomputed cells by key instead of scanning voters', () => {
    const { sql, params } = buildVoterDensitySql(DISTRICT_ID, 8)

    expect(sql).toContain('gp_api_district_voter_density')
    expect(sql).toContain('WHERE district_id = :p0')
    expect(sql).toContain('AND resolution = :p1')
    // The whole point of the precomputed mart: no H3 math, no voter rows.
    expect(sql).not.toContain('gp_api_voters')
    expect(sql).not.toContain('h3_')
    expect(params).toEqual([
      { name: 'p0', value: DISTRICT_ID, type: 'STRING' },
      { name: 'p1', value: '8', type: 'INT' },
    ])
  })

  it('orders by lat then lng, matching the Postgres arm', () => {
    const { sql } = buildVoterDensitySql(DISTRICT_ID, 8)

    expect(sql).toContain('ORDER BY lat, lng')
  })

  it('lowercases the district id before binding it', () => {
    const { params } = buildVoterDensitySql(DISTRICT_ID.toUpperCase(), 8)

    expect(params[0]?.value).toBe(DISTRICT_ID)
  })

  it('binds the resolution rather than splicing it in', () => {
    const { sql, params } = buildVoterDensitySql(DISTRICT_ID, 9)

    expect(sql).not.toContain('resolution = 9')
    expect(params[1]).toEqual({ name: 'p1', value: '9', type: 'INT' })
  })
})

describe('buildVoterDensityMetaSql', () => {
  it('reads one coverage row by its composite key', () => {
    const { sql, params } = buildVoterDensityMetaSql(DISTRICT_ID, 8)

    expect(sql).toContain('gp_api_district_voter_density_meta')
    expect(sql).toContain('coverage')
    expect(sql).toContain('WHERE district_id = :p0')
    expect(sql).toContain('AND resolution = :p1')
    expect(params).toEqual([
      { name: 'p0', value: DISTRICT_ID, type: 'STRING' },
      { name: 'p1', value: '8', type: 'INT' },
    ])
  })

  it('lowercases the district id before binding it', () => {
    const { params } = buildVoterDensityMetaSql(DISTRICT_ID.toUpperCase(), 8)

    expect(params[0]?.value).toBe(DISTRICT_ID)
  })
})

describe('mapVoterDensityCells', () => {
  it('coerces the positional string row into a typed cell', () => {
    const cells = mapVoterDensityCells([
      ['43.1', '-108.2', '25'],
      ['43.2', '-108.3', '11'],
    ])

    expect(cells).toEqual([
      { lat: 43.1, lng: -108.2, count: 25 },
      { lat: 43.2, lng: -108.3, count: 11 },
    ])
  })

  it('returns no cells for a district with no rows', () => {
    expect(mapVoterDensityCells([])).toEqual([])
  })

  it('drops a row with a null coordinate rather than emitting NaN', () => {
    // A NaN centroid would reach the map as a broken marker; the cell is not
    // renderable, so it is not a cell.
    const cells = mapVoterDensityCells([
      ['43.1', null, '25'],
      ['43.2', '-108.3', '11'],
    ])

    expect(cells).toEqual([{ lat: 43.2, lng: -108.3, count: 11 }])
  })

  it('drops a row with a null count rather than emitting a zero cell', () => {
    // Number(null) is 0, and a zero-voter cell is one k-anonymity cannot
    // publish, so emitting it would put an impossible value on the map.
    const cells = mapVoterDensityCells([
      ['43.1', '-108.2', null],
      ['43.2', '-108.3', '11'],
    ])

    expect(cells).toEqual([{ lat: 43.2, lng: -108.3, count: 11 }])
  })
})

describe('mapVoterDensityCoverage', () => {
  it('reads coverage off the single meta row', () => {
    expect(mapVoterDensityCoverage([['0.982']])).toBe(0.982)
  })

  it('is null when the district has no meta row', () => {
    // Distinct from 0: "no row" means the pipeline never published this
    // (district, resolution), which the page treats as do-not-render.
    expect(mapVoterDensityCoverage([])).toBeNull()
  })

  it('is null when the meta row carries a null coverage', () => {
    expect(mapVoterDensityCoverage([[null]])).toBeNull()
  })
})
