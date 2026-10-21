import { AsyncLocalStorage } from 'node:async_hooks'

// POC (import contacts, do not merge). With POC_IMPORT_CONTACTS_ENABLED=true,
// every contacts read for an org swaps the vendor people table for the
// universal contacts view: vendor people in the district, full-outer-joined
// to the org's uploaded contacts through their active links. The contacts
// tables are read from a mirror of gp-api Postgres, located by
// POC_IMPORT_CONTACTS_MIRROR_SCHEMA.

export const DEFAULT_MIRROR_SCHEMA =
  'goodparty_data_catalog.poc_import_contacts_mirror'

export const UNIVERSAL_CONTACT_COLUMNS = [
  'contact_id',
  'contact_verified',
  'contact_email',
] as const

export const isImportContactsPocEnabled = (): boolean =>
  process.env.POC_IMPORT_CONTACTS_ENABLED === 'true'

export const universalContactsViewStorage = new AsyncLocalStorage<{
  orgSlug: string
}>()

const NAME_PART = '(?:[A-Za-z0-9_]+|`[^`]+`)'
const SCHEMA_NAME = new RegExp(`^${NAME_PART}\\.${NAME_PART}$`)
const TABLE_NAME = new RegExp(`^${NAME_PART}(?:\\.${NAME_PART}){2}$`)

export const mirrorSchema = (): string => {
  const schema =
    process.env.POC_IMPORT_CONTACTS_MIRROR_SCHEMA || DEFAULT_MIRROR_SCHEMA
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`Bad POC_IMPORT_CONTACTS_MIRROR_SCHEMA ${schema}`)
  }
  return schema
}

// Local testing only: points matching and the view at a table of synthetic
// people so review screens never show real vendor people.
export const pocVendorTable = (baseTable: string): string => {
  const table = process.env.POC_IMPORT_CONTACTS_VENDOR_TABLE
  if (!table) return baseTable
  if (!TABLE_NAME.test(table)) {
    throw new Error(`Bad POC_IMPORT_CONTACTS_VENDOR_TABLE ${table}`)
  }
  return table
}

const ORG_SLUG = /^[a-z0-9-]+$/
const IDENT = /^[A-Za-z0-9_]+$/

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`

// Vendor fields win for a linked contact; the upload fills only a contact
// with no in-district vendor person. Keep this one FULL OUTER JOIN over a
// district-filtered base: a UNION re-reads all ~989 vendor columns and
// doubled compile time in the earlier POC.
const CONTACT_FIELDS = [
  ['FirstName', 'first_name'],
  ['LastName', 'last_name'],
  ['Residence_Addresses_AddressLine', 'address'],
  ['Residence_Addresses_City', 'city'],
  ['Residence_Addresses_Zip', 'zip'],
  ['VoterTelephones_CellPhoneFormatted', 'phone'],
] as const

export const universalContactsViewSql = (args: {
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
  const schema = mirrorSchema()
  const district =
    districtType && districtName
      ? { type: districtType, name: districtName }
      : null
  const replaced = [
    'id',
    'State',
    ...(district ? [district.type] : []),
    'Residence_Addresses_State',
    ...CONTACT_FIELDS.map(([vendor]) => vendor),
  ].join(', ')
  const contactAggregates = CONTACT_FIELDS.map(
    ([, contact]) => `max_by(oc.${contact}, oc.created_at) AS ${contact}`,
  ).join(',\n    ')
  const fields = CONTACT_FIELDS.map(
    ([vendor, contact]) => `coalesce(b.${vendor}, c.${contact}) AS ${vendor}`,
  ).join(', ')
  const districtColumn = district
    ? `, ${lit(district.name)} AS ${district.type}`
    : ''
  const districtWhere = district
    ? ` AND ${district.type} = ${lit(district.name)}`
    : ''
  return `(WITH c AS (
  SELECT coalesce(l.vendor_person_id, oc.id) AS join_id,
    max_by(oc.id, oc.created_at) AS contact_id,
    max_by(oc.email, oc.created_at) AS email,
    ${contactAggregates}
  FROM ${schema}.org_contact oc
  LEFT JOIN ${schema}.org_contact_link l
    ON l.org_contact_id = oc.id AND l.revoked_at IS NULL
  WHERE oc.organization_slug = ${lit(orgSlug)} AND oc.deleted_at IS NULL
  GROUP BY coalesce(l.vendor_person_id, oc.id)
)
SELECT b.* EXCEPT (${replaced}),
  coalesce(b.id, c.contact_id) AS id, ${lit(state)} AS State${districtColumn},
  CASE WHEN b.id IS NULL THEN ${lit(state)} ELSE b.Residence_Addresses_State END AS Residence_Addresses_State,
  ${fields},
  c.contact_id, b.id IS NOT NULL AS contact_verified, c.email AS contact_email
FROM (SELECT * FROM ${baseTable} WHERE State = ${lit(state)}${districtWhere}) b
FULL OUTER JOIN c ON c.join_id = b.id)`
}
