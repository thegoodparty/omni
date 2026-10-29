import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildConstituentDataScope,
  CONSTITUENT_TABLES_BY_DATASET,
} from './constituentDataScope'

const FILTERS = [
  { column: 'state_postal_code', value: 'MI' },
  { column: 'City', value: "O'Fallon" },
]

describe('buildConstituentDataScope', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('has no overlay and no overlay dimensions without an org overlay', () => {
    const scope = buildConstituentDataScope(
      FILTERS,
      CONSTITUENT_TABLES_BY_DATASET.constituents,
      { base: 'constituents' },
    )

    expect(scope.contactOverlayTable).toBeUndefined()
    expect(scope.allowedDimensions.has('on_uploaded_list')).toBe(false)
    expect(scope.allowedDimensions.has('has_email')).toBe(false)
  })

  it('joins the district to the org overlay and allows its dimensions', () => {
    vi.stubEnv(
      'SERVE_AGENT_CONTACT_OVERLAY_VIEW',
      'serve_agent_contact_overlay_dev',
    )
    const scope = buildConstituentDataScope(
      FILTERS,
      CONSTITUENT_TABLES_BY_DATASET.constituents,
      {
        base: 'constituents',
        overlayOrgSlug: 'eo-lansing',
        overlayDistrictId: 'district-1',
      },
    )

    expect(scope.contactOverlayTable).toBe(
      '(SELECT b.* EXCEPT (`voter_key`, `state_postal_code`, `City`),' +
        ' coalesce(b.`voter_key`, o.`voter_key`) AS `voter_key`,' +
        " 'MI' AS `state_postal_code`, 'O\\'Fallon' AS `City`," +
        ' coalesce(o.`on_uploaded_list`, false) AS `on_uploaded_list`,' +
        ' coalesce(o.`has_email`, false) AS `has_email`' +
        ' FROM (SELECT * FROM' +
        ' goodparty_data_catalog.mart_serve_agents.serve_agent_constituents' +
        " WHERE `state_postal_code` = 'MI' AND `City` = 'O\\'Fallon') b" +
        ' FULL OUTER JOIN (SELECT * FROM' +
        ' goodparty_data_catalog.mart_serve_agents.serve_agent_contact_overlay_dev' +
        " WHERE organization_slug = 'eo-lansing') o" +
        ' ON o.`voter_key` = b.`voter_key`)',
    )
    expect(scope.allowedDimensions.has('on_uploaded_list')).toBe(true)
    expect(scope.allowedDimensions.has('has_email')).toBe(true)
    expect(scope.advertisedDimensions.map((d) => d.name)).toEqual(
      expect.arrayContaining(['on_uploaded_list', 'has_email']),
    )
  })
})
