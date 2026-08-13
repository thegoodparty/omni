import { describe, expect, it } from 'vitest'
import { buildBboxSql } from './bboxSql.util'

const bbox = { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 }

describe('buildBboxSql', () => {
  it('guards the float cast behind a CASE regex check', () => {
    const sql = buildBboxSql(bbox)
    const sqlStr = sql.strings.join('?')

    expect(sqlStr).toContain('CASE WHEN v."Residence_Addresses_Latitude" ~')
    expect(sqlStr).toContain('CASE WHEN v."Residence_Addresses_Longitude" ~')
    expect(sqlStr).toContain('::float8 END')
    expect(sqlStr).not.toMatch(/Latitude"::float8 [^E]/)
  })

  it('binds the bbox bounds and the numeric-text regex as parameters', () => {
    const sql = buildBboxSql(bbox)

    expect(sql.values).toContain(41.8)
    expect(sql.values).toContain(41.9)
    expect(sql.values).toContain(-87.7)
    expect(sql.values).toContain(-87.6)
    expect(sql.values).toContain('^-?[0-9]+(\\.[0-9]+)?$')
  })

  it('produces BETWEEN clauses for both axes', () => {
    const sqlStr = buildBboxSql(bbox).strings.join('?')
    expect(sqlStr.match(/BETWEEN/g)).toHaveLength(2)
  })
})
