import { AsyncLocalStorage } from 'node:async_hooks'

// POC (import contacts, Delta storage): an org's own people and fixes live in
// one append-only Delta log, and every people read swaps the vendor table for
// a per-org view over vendor rows + that log. Branch-only; never merges.

export const ORG_LAYER_SCHEMA = 'goodparty_data_catalog.poc_import_contacts'
export const ORG_LAYER_LOG_TABLE = `${ORG_LAYER_SCHEMA}.org_contact_event`
export const ORG_LAYER_IMPORT_ROW_TABLE = `${ORG_LAYER_SCHEMA}.org_import_row`

export const ORG_LAYER_FIELDS = [
  'FirstName',
  'LastName',
  'Residence_Addresses_AddressLine',
  'Residence_Addresses_City',
  'Residence_Addresses_Zip',
  'VoterTelephones_CellPhoneFormatted',
  'VoterTelephones_LandlineFormatted',
] as const

export type OrgLayerField = (typeof ORG_LAYER_FIELDS)[number] | 'email'

export const orgLayerStorage = new AsyncLocalStorage<{ orgSlug: string }>()

export const isOrgLayerPocEnabled = (): boolean =>
  process.env.POC_ORG_LAYER_ENABLED === 'true'

const ORG_SLUG = /^[a-z0-9-]+$/
const IDENT = /^[A-Za-z0-9_]+$/

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`

export const personViewSql = (args: {
  baseTable: string
  orgSlug: string
  state: string
  districtType?: string
  districtName?: string
}): string => {
  const { baseTable, orgSlug, state, districtType, districtName } = args
  if (!ORG_SLUG.test(orgSlug)) throw new Error(`Bad org slug ${orgSlug}`)
  if (districtType && !IDENT.test(districtType)) {
    throw new Error(`Bad district type ${districtType}`)
  }
  const scopeCols = ['id', 'State', ...(districtType ? [districtType] : [])]
  const exceptCols = [...scopeCols, ...ORG_LAYER_FIELDS].join(', ')
  const pivots = [...ORG_LAYER_FIELDS, 'email']
    .map(
      (f) =>
        `max_by(value, created_at) FILTER (WHERE kind = 'set' AND field = '${f}') AS ${f}`,
    )
    .join(',\n    ')
  const vendorScope = scopeCols.map((c) => `b.${c} AS ${c}`).join(', ')
  const orgScope = [
    'p.person_id AS id',
    `${lit(state)} AS State`,
    ...(districtType && districtName
      ? [`${lit(districtName)} AS ${districtType}`]
      : []),
  ].join(', ')
  const vendorFields = ORG_LAYER_FIELDS.map(
    (f) => `COALESCE(p.${f}, b.${f}) AS ${f}`,
  ).join(', ')
  const orgFields = ORG_LAYER_FIELDS.map((f) => `p.${f} AS ${f}`).join(', ')
  return `(WITH p AS (
  SELECT person_id,
    ${pivots},
    max(kind = 'create') AS is_new,
    coalesce(max_by(kind, created_at) FILTER (WHERE kind IN ('remove', 'restore')) = 'remove', false) AS removed
  FROM ${ORG_LAYER_LOG_TABLE} WHERE org_slug = ${lit(orgSlug)} GROUP BY person_id
)
SELECT b.* EXCEPT (${exceptCols}), ${vendorScope}, ${vendorFields}, p.email AS poc_email,
  IF(p.person_id IS NULL, 'vendor', 'vendor+org') AS poc_origin
FROM ${baseTable} b LEFT JOIN p ON p.person_id = b.id
WHERE NOT coalesce(p.removed, false)
UNION ALL
SELECT b.* EXCEPT (${exceptCols}), ${orgScope}, ${orgFields}, p.email AS poc_email, 'org' AS poc_origin
FROM p LEFT JOIN ${baseTable} b ON 1 = 0
WHERE p.is_new AND NOT p.removed)`
}
