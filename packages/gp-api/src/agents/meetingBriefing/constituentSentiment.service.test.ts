import { describe, expect, it } from 'vitest'
import type { DatabricksRowSet } from '@/llm/tools/queryDatabricks.tool'
import { ConstituentSentimentService } from './constituentSentiment.service'

const fakeWarehouse = (
  answer: (sql: string) => Array<Record<string, unknown>>,
) => {
  const queries: string[] = []
  return {
    queries,
    provider: {
      query: async (sql: string): Promise<DatabricksRowSet> => {
        queries.push(sql)
        return { columns: [], rows: answer(sql) }
      },
    },
  }
}

const districtValues = [
  { district_value: 'NEW YORK CITY CNCL DIST 25 (EST.)', n: '120000' },
  { district_value: 'NEW YORK CITY CNCL DIST 26 (EST.)', n: '110000' },
]

describe('ConstituentSentimentService', () => {
  it('resolves the district by substring and averages within it', async () => {
    const warehouse = fakeWarehouse((sql) =>
      sql.includes('district_value')
        ? districtValues
        : [{ hs_gun_control_support: '61.8', constituent_count: '120000' }],
    )
    const result = await new ConstituentSentimentService(
      warehouse.provider,
    ).meanScores({
      state: 'NY',
      columns: ['hs_gun_control_support'],
      district: { type: 'City_Council_Commissioner_District', name: 'dist 25' },
    })

    expect(result).toMatchObject({
      scope: 'district',
      districtResolved: true,
      districtValue: 'NEW YORK CITY CNCL DIST 25 (EST.)',
      constituentCount: 120000,
      meanScores: { hs_gun_control_support: 61.8 },
      suppressed: false,
    })
    expect(result.query).toContain(
      "`City_Council_Commissioner_District` = 'NEW YORK CITY CNCL DIST 25 (EST.)'",
    )
    expect(result.query).toContain("Residence_Addresses_State = 'NY'")
    expect(result.query).toContain("Voters_Active = 'A'")
  })

  it('falls back to state scope when the district does not resolve', async () => {
    const warehouse = fakeWarehouse((sql) =>
      sql.includes('district_value')
        ? districtValues
        : [{ hs_gun_control_support: '50.2', constituent_count: '6484104' }],
    )
    const result = await new ConstituentSentimentService(
      warehouse.provider,
    ).meanScores({
      state: 'NY',
      columns: ['hs_gun_control_support'],
      district: { type: 'City_Council_Commissioner_District', name: '99' },
    })

    expect(result.scope).toBe('state')
    expect(result.districtResolved).toBe(false)
    expect(result.query).not.toContain('City_Council_Commissioner_District')
  })

  it('never looks up a district column the mart does not have', async () => {
    const warehouse = fakeWarehouse(() => [
      { hs_gun_control_support: '50', constituent_count: '500' },
    ])
    const result = await new ConstituentSentimentService(
      warehouse.provider,
    ).meanScores({
      state: 'NY',
      columns: ['hs_gun_control_support'],
      district: { type: 'Not_A_Column', name: '25' },
    })

    expect(result.scope).toBe('state')
    expect(warehouse.queries).toHaveLength(1)
  })

  it('suppresses means below the cell floor', async () => {
    const warehouse = fakeWarehouse(() => [
      { hs_gun_control_support: '70', constituent_count: '42' },
    ])
    const result = await new ConstituentSentimentService(
      warehouse.provider,
    ).meanScores({ state: 'NY', columns: ['hs_gun_control_support'] })

    expect(result.suppressed).toBe(true)
    expect(result.meanScores).toEqual({ hs_gun_control_support: null })
  })

  it('refuses columns outside the briefing catalog', async () => {
    const warehouse = fakeWarehouse(() => [])
    await expect(
      new ConstituentSentimentService(warehouse.provider).meanScores({
        state: 'NY',
        columns: ['hs_ideology_fiscal_liberal'],
      }),
    ).rejects.toThrow(/not in it: hs_ideology_fiscal_liberal/)
    expect(warehouse.queries).toHaveLength(0)
  })

  it('names the missing warehouse when no credential is configured', async () => {
    await expect(
      new ConstituentSentimentService(null).meanScores({
        state: 'NY',
        columns: ['hs_gun_control_support'],
      }),
    ).rejects.toThrow('ConstituentDataUnavailable')
  })
})
