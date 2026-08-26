// Builds a synthetic green."Voter" slice wide enough to reproduce the pack
// query's driver cost: the real 20-column projection, the real household-key
// columns, real value vocabularies and null rates, and a realistic tuple width.
// Throwaway measurement code — not part of the build.

import { Client } from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROWS = Number(process.env.ROWS ?? 300_000)
// Not named URL: that would shadow the global URL constructor, which the
// localhost guard in main() needs.
const PG_URL =
  process.env.PGURL ?? 'postgres://postgres:pw@localhost:5599/peopledb'

let seed = 0x9e3779b9
const rnd = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) / 0x100000000
}
const pick = (table) => {
  const r = rnd()
  let acc = 0
  for (const [value, weight] of table) {
    acc += weight
    if (r < acc) return value
  }
  return table[table.length - 1][0]
}

// Vocabularies taken from VALUE_MAPPERS / politicalParty.rules.ts, so string
// lengths (which set both wire bytes and driver allocation) are right.
const PARTY = [
  ['Democratic', 0.379],
  ['Republican', 0.319],
  ['Non-Partisan', 0.277],
  ['American Independent', 0.0052],
  ['Registered Independent', 0.0049],
  ['Declined to State', 0.0017],
  ['Libertarian', 0.004],
  [null, 0.009],
]
const GENDER = [
  ['M', 0.47],
  ['F', 0.5],
  [null, 0.03],
]
const MARITAL = [
  ['Inferred Married', 0.24],
  ['Inferred Single', 0.19],
  ['Married', 0.14],
  ['Single', 0.08],
  [null, 0.35],
]
const VETERAN = [
  ['Yes', 0.08],
  [null, 0.92],
]
const CHILDREN = [
  ['Yes', 0.3],
  ['No', 0.25],
  [null, 0.45],
]
const HOMEOWNER = [
  ['Home Owner', 0.42],
  ['Probable Home Owner', 0.18],
  ['Renter', 0.15],
  [null, 0.25],
]
const EDUCATION = [
  ['HS Diploma - Likely', 0.16],
  ['Some College - Likely', 0.14],
  ['Bach Degree - Likely', 0.17],
  ['Attended But Did Not Complete College Likely', 0.06],
  ['Grad Degree - Likely', 0.07],
  [null, 0.4],
]
const ETHNICITY = [
  ['European', 0.55],
  ['Hispanic and Portuguese', 0.16],
  ['Likely African-American', 0.09],
  ['East and South Asian', 0.05],
  [null, 0.15],
]
const VOTER_STATUS = [
  ['Unlikely', 0.24],
  ['Unreliable', 0.24],
  ['Likely', 0.25],
  ['Super', 0.2],
  ['Unknown', 0.07],
]
const LANGUAGE = [
  ['English', 0.7],
  ['Spanish', 0.1],
  [null, 0.2],
]
const BUSINESS = [
  ['Yes', 0.05],
  [null, 0.95],
]

const STREETS = [
  'MAPLE',
  'OAK',
  'CEDAR',
  'PARKWOOD',
  'LEGACY',
  'PRESTON',
  'CUSTER',
  'INDEPENDENCE',
  'COIT',
  'HILLCREST',
  'ALMA',
  'SPRING CREEK',
  'PLANO',
  'JUPITER',
  'RENNER',
  'ROWLETT',
  'STACY',
  'ELDORADO',
  'VIRGINIA',
  'PARK',
]
const SUFFIX = ['DR', 'ST', 'LN', 'RD', 'BLVD', 'CT', 'WAY', 'PKWY']
const CITIES = [
  'PLANO',
  'MCKINNEY',
  'FRISCO',
  'ALLEN',
  'WYLIE',
  'PROSPER',
  'CELINA',
]

const uuid = () => {
  const h = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 32; i++) {
    out += h[(rnd() * 16) | 0]
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-'
  }
  return out
}

const esc = (v) =>
  v === null
    ? '\\N'
    : String(v)
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')

const DDL = `
DROP SCHEMA IF EXISTS green CASCADE;
CREATE SCHEMA green;
CREATE TABLE green."Voter" (
  "id" uuid PRIMARY KEY,
  "State" text NOT NULL,
  "Residence_Addresses_Latitude" text,
  "Residence_Addresses_Longitude" text,
  "Residence_Addresses_LatLongAccuracy" text,
  "Residence_Addresses_AddressLine" text,
  "Residence_Addresses_City" text,
  "Residence_Addresses_State" text,
  "Residence_Addresses_Zip" text,
  "Parties_Description" text,
  "Age_Int" integer,
  "Gender" text,
  "Voter_Status" text,
  "Marital_Status" text,
  "Veteran_Status" text,
  "Presence_Of_Children" text,
  "Homeowner_Probability_Model" text,
  "Business_Owner" text,
  "Education_Of_Person" text,
  "Estimated_Income_Amount_Int" integer,
  "Language_Code" text,
  "EthnicGroups_EthnicGroup1Desc" text,
  "StateVoterID" text,
  "VoterTelephones_CellPhoneFormatted" text,
  "VoterTelephones_LandlineFormatted" text,
  -- Filler so the heap tuple is ~546 bytes like the real 113-column row: the
  -- scan fetches whole tuples, and tuple width sets pages-per-row.
  "f1" text, "f2" text, "f3" text, "f4" text, "f5" text, "f6" text,
  "f7" text, "f8" text, "f9" text, "f10" text
);
CREATE TABLE green."DistrictVoter" (
  "State" text NOT NULL,
  "district_id" text NOT NULL,
  "voter_id" uuid NOT NULL,
  PRIMARY KEY ("district_id", "voter_id")
);
`

const COLUMNS = [
  'id',
  'State',
  'Residence_Addresses_Latitude',
  'Residence_Addresses_Longitude',
  'Residence_Addresses_LatLongAccuracy',
  'Residence_Addresses_AddressLine',
  'Residence_Addresses_City',
  'Residence_Addresses_State',
  'Residence_Addresses_Zip',
  'Parties_Description',
  'Age_Int',
  'Gender',
  'Voter_Status',
  'Marital_Status',
  'Veteran_Status',
  'Presence_Of_Children',
  'Homeowner_Probability_Model',
  'Business_Owner',
  'Education_Of_Person',
  'Estimated_Income_Amount_Int',
  'Language_Code',
  'EthnicGroups_EthnicGroup1Desc',
  'StateVoterID',
  'VoterTelephones_CellPhoneFormatted',
  'VoterTelephones_LandlineFormatted',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
]

const FILLER = 'X'.repeat(30)

function* voterRows(district) {
  // Households: ~2.03 mappable people share a household key, 6% of buildings
  // multi-unit averaging 10.5 units on one rooftop coordinate.
  let i = 0
  while (i < ROWS) {
    const houseNo = 100 + ((rnd() * 9000) | 0)
    const street = `${houseNo} ${STREETS[(rnd() * STREETS.length) | 0]} ${SUFFIX[(rnd() * SUFFIX.length) | 0]}`
    const city = CITIES[(rnd() * CITIES.length) | 0]
    const zip = String(75000 + ((rnd() * 400) | 0))
    const lat = (32.95 + rnd() * 0.55).toFixed(6)
    const lng = (-96.9 + rnd() * 0.7).toFixed(6)
    const multiUnit = rnd() < 0.06
    const units = multiUnit ? 1 + ((rnd() * 20) | 0) : 1
    for (let u = 0; u < units && i < ROWS; u++) {
      const addressLine = multiUnit ? `${street} APT ${u + 1}` : street
      const size = 1 + ((rnd() * 3) | 0)
      for (let p = 0; p < size && i < ROWS; p++) {
        const id = uuid()
        // 14% fail the MAPPABLE_ONLY gate: 75% bad accuracy, 25% unparseable
        // coords — the second kind is what makes the regexes load bearing.
        const roll = rnd()
        const accuracy = roll < 0.105 ? 'GeoMatchZip4' : 'GeoMatchRooftop'
        const badCoords = roll >= 0.105 && roll < 0.14
        const row = {
          id,
          State: 'TX',
          Residence_Addresses_Latitude: badCoords ? 'N/A' : lat,
          Residence_Addresses_Longitude: badCoords ? '' : lng,
          Residence_Addresses_LatLongAccuracy: accuracy,
          Residence_Addresses_AddressLine: addressLine,
          Residence_Addresses_City: city,
          Residence_Addresses_State: 'TX',
          Residence_Addresses_Zip: zip,
          Parties_Description: pick(PARTY),
          Age_Int: 18 + ((rnd() * 70) | 0),
          Gender: pick(GENDER),
          Voter_Status: pick(VOTER_STATUS),
          Marital_Status: pick(MARITAL),
          Veteran_Status: pick(VETERAN),
          Presence_Of_Children: pick(CHILDREN),
          Homeowner_Probability_Model: pick(HOMEOWNER),
          Business_Owner: pick(BUSINESS),
          Education_Of_Person: pick(EDUCATION),
          Estimated_Income_Amount_Int:
            rnd() < 0.7 ? 20000 + ((rnd() * 180000) | 0) : null,
          Language_Code: pick(LANGUAGE),
          EthnicGroups_EthnicGroup1Desc: pick(ETHNICITY),
          StateVoterID: rnd() < 0.88 ? `TX${(rnd() * 1e10) | 0}` : null,
          VoterTelephones_CellPhoneFormatted:
            rnd() < 0.45 ? '(972) 555-0100' : null,
          VoterTelephones_LandlineFormatted:
            rnd() < 0.18 ? '(972) 555-0200' : null,
        }
        for (let f = 1; f <= 10; f++) row[`f${f}`] = rnd() < 0.6 ? FILLER : null
        i++
        yield { row, district }
      }
    }
  }
}

const main = async () => {
  // The DDL below drops and recreates `green`, which on the real people-db
  // mirror is the production voter schema. A PGURL left over from a VPN
  // session would destroy it, so refuse anything that is not plainly local.
  const { hostname } = new URL(PG_URL)
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(
      `refusing to run against "${hostname}": this script drops the green ` +
        'schema. Point PGURL at a local Postgres.',
    )
  }

  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  console.log(`creating schema, ${ROWS.toLocaleString()} rows`)
  await client.query(DDL)

  const district = 'tx-collin-county'
  const gen = voterRows(district)
  const voterLines = []
  const dvLines = []
  for (const { row } of gen) {
    voterLines.push(COLUMNS.map((c) => esc(row[c])).join('\t'))
    dvLines.push(`TX\t${district}\t${row.id}`)
  }

  const copy = async (sql, lines) => {
    const stream = client.query(copyFrom(sql))
    await pipeline(Readable.from(lines.map((l) => l + '\n')), stream)
  }
  await copy(
    `COPY green."Voter" (${COLUMNS.map((c) => `"${c}"`).join(',')}) FROM STDIN`,
    voterLines,
  )
  await copy(
    'COPY green."DistrictVoter" ("State","district_id","voter_id") FROM STDIN',
    dvLines,
  )
  await client.query('ANALYZE green."Voter"')
  await client.query('ANALYZE green."DistrictVoter"')
  const { rows } = await client.query(`
    SELECT count(*) AS total,
           count(*) FILTER (
             WHERE "Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'
               AND "Residence_Addresses_Latitude" ~ '^-?[0-9]+(\\.[0-9]+)?$'
               AND "Residence_Addresses_Longitude" ~ '^-?[0-9]+(\\.[0-9]+)?$') AS mappable,
           pg_size_pretty(pg_total_relation_size('green."Voter"')) AS size,
           (SELECT avg(pg_column_size(v)) FROM green."Voter" v) AS avg_tuple
    FROM green."Voter"`)
  console.log(rows[0])
  await client.end()
}

await main()
