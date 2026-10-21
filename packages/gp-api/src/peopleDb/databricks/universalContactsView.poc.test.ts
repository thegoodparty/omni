import { afterEach, describe, expect, it, vi } from 'vitest'
import { universalContactsViewSql } from './universalContactsView.poc'

const BASE = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'

describe('universalContactsViewSql', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('full-outer-joins the district-filtered base to the org contacts once', () => {
    const sql = universalContactsViewSql({
      baseTable: BASE,
      orgSlug: 'eo-houghton',
      state: 'MI',
      districtType: 'City',
      districtName: "O'HOUGHTON CITY",
    })
    expect(sql.match(/FULL OUTER JOIN/g)).toHaveLength(1)
    expect(sql).not.toMatch(/UNION/i)
    expect(sql).toContain(
      `FROM (SELECT * FROM ${BASE} WHERE State = 'MI' AND City = 'O''HOUGHTON CITY') b`,
    )
    expect(sql).toContain(
      'FROM goodparty_data_catalog.poc_import_contacts_mirror.org_contact oc',
    )
    expect(sql).toContain("oc.organization_slug = 'eo-houghton'")
    expect(sql).toContain('l.revoked_at IS NULL')
    expect(sql).toContain('b.id IS NOT NULL AS contact_verified')
    expect(sql).toContain('c.email AS contact_email')
  })

  it('reads the mirror from POC_IMPORT_CONTACTS_MIRROR_SCHEMA', () => {
    vi.stubEnv(
      'POC_IMPORT_CONTACTS_MIRROR_SCHEMA',
      'goodparty_data_catalog.gp_api_mirror_lakeflow',
    )
    const sql = universalContactsViewSql({
      baseTable: BASE,
      orgSlug: 'eo-houghton',
      state: 'MI',
    })
    expect(sql).toContain(
      'goodparty_data_catalog.gp_api_mirror_lakeflow.org_contact_link l',
    )
    expect(sql).toContain(`WHERE State = 'MI') b`)
  })

  it('rejects an org slug or mirror schema it cannot splice safely', () => {
    expect(() =>
      universalContactsViewSql({
        baseTable: BASE,
        orgSlug: "eo-x' OR 1=1",
        state: 'MI',
      }),
    ).toThrow('Bad org slug')
    vi.stubEnv('POC_IMPORT_CONTACTS_MIRROR_SCHEMA', 'a.b; DROP TABLE c')
    expect(() =>
      universalContactsViewSql({
        baseTable: BASE,
        orgSlug: 'eo-houghton',
        state: 'MI',
      }),
    ).toThrow('Bad POC_IMPORT_CONTACTS_MIRROR_SCHEMA')
  })
})
