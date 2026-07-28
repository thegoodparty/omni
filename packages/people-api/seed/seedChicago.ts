// Local-only Chicago test-bed loader (untracked). Run from packages/people-api:
//
//   npx tsx seed/seedChicago.ts            # dense North Side slice (~Lakeview)
//   npx tsx seed/seedChicago.ts --all      # full 1.69M-voter city
//
// Reads the benchmark export at ~/projects/door-knocking-research/
// chicago_voters.result.csv (real addresses/coords/party/age; no names) and
// loads it into the local peopledb as statewide-IL voters, so the existing
// State/IL district's voter-only path scopes to it. Names and the dims the
// CSV lacks are synthesized — real geography, fake people. Wipes existing IL
// voters first so reruns and the old synthetic seed don't stack.

import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { join } from 'path'
import { faker } from '@faker-js/faker'
import { Prisma, PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

const CSV_PATH = join(
  homedir(),
  'projects/door-knocking-research/chicago_voters.result.csv',
)
const ALL = process.argv.includes('--all')
// Lakeview / Lincoln Park-ish: dense, heavy on apartments.
const BBOX = { minLat: 41.9, maxLat: 41.96, minLng: -87.68, maxLng: -87.62 }
const BATCH = 5_000

const uuidFromL2 = (lalVoterId: string): string => {
  const hex = createHash('md5').update(lalVoterId).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Minimal quoted-CSV line parser (the export quotes fields with commas).
const parseCsvLine = (line: string): string[] => {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const orNull = (value: string | undefined): string | null =>
  value !== undefined && value !== '' ? value : null

const VOTER_STATUSES = ['Unlikely', 'First Time', 'Likely', 'Super', 'Unknown']

async function main() {
  const district = await prisma.district.upsert({
    where: { type_name_state: { type: 'State', name: 'IL', state: 'IL' } },
    update: {},
    // Real election-api district id (IL statewide, election-api QA):
    // gp-api's org PATCH resolves the override district against election-api,
    // so a made-up uuid breaks onboarding with a 502.
    create: {
      id: 'ac05fd08-f4b0-c23b-3ebd-c8540641ccac',
      type: 'State',
      name: 'IL',
      state: 'IL',
    },
  })

  const wiped = await prisma.voter.deleteMany({ where: { State: 'IL' } })
  console.log(`Wiped ${wiped.count} existing IL voters`)

  const rl = createInterface({
    input: createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  })

  let header: string[] | null = null
  let col: Record<string, number> = {}
  const idx = (name: string): number => col[name] ?? -1
  let batch: Prisma.VoterCreateManyInput[] = []
  let read = 0
  let inserted = 0

  const flush = async () => {
    if (batch.length === 0) return
    const result = await prisma.voter.createMany({
      data: batch,
      skipDuplicates: true,
    })
    inserted += result.count
    batch = []
    if (inserted % 100_000 < BATCH) {
      console.log(`  ${inserted.toLocaleString()} inserted…`)
    }
  }

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line)
      col = Object.fromEntries(header.map((name, i) => [name, i]))
      continue
    }
    read++
    const f = parseCsvLine(line)
    const lat = parseFloat(f[idx('Residence_Addresses_Latitude')] ?? '')
    const lng = parseFloat(f[idx('Residence_Addresses_Longitude')] ?? '')
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue
    if (
      !ALL &&
      (lat < BBOX.minLat ||
        lat > BBOX.maxLat ||
        lng < BBOX.minLng ||
        lng > BBOX.maxLng)
    ) {
      continue
    }
    const lalVoterId = f[idx('LALVOTERID')] ?? ''
    if (!lalVoterId) continue

    const age = parseInt(f[idx('Voters_Age')] ?? '', 10)
    // Deterministic-ish per voter so reruns look the same.
    const roll = parseInt(
      createHash('md5').update(lalVoterId).digest('hex').slice(0, 4),
      16,
    )

    batch.push({
      id: uuidFromL2(lalVoterId),
      LALVOTERID: lalVoterId,
      State: 'IL',
      FirstName: faker.person.firstName(),
      LastName: faker.person.lastName(),
      Residence_Addresses_Latitude:
        f[idx('Residence_Addresses_Latitude')] ?? null,
      Residence_Addresses_Longitude:
        f[idx('Residence_Addresses_Longitude')] ?? null,
      Residence_Addresses_LatLongAccuracy: orNull(
        f[idx('Residence_Addresses_LatLongAccuracy')],
      ),
      Residence_Addresses_HouseNumber: orNull(
        f[idx('Residence_Addresses_HouseNumber')],
      ),
      // The model types PrefixDirection as Int (L2 ships "N"/"W" text), so
      // fold the direction into the street name: keys stay distinct and the
      // display reads right.
      Residence_Addresses_StreetName: orNull(
        [
          f[idx('Residence_Addresses_PrefixDirection')],
          f[idx('Residence_Addresses_StreetName')],
        ]
          .filter(Boolean)
          .join(' '),
      ),
      Residence_Addresses_Designator: orNull(
        f[idx('Residence_Addresses_Designator')],
      ),
      Residence_Addresses_ApartmentType: orNull(
        f[idx('Residence_Addresses_ApartmentType')],
      ),
      Residence_Addresses_ApartmentNum: orNull(
        f[idx('Residence_Addresses_ApartmentNum')],
      ),
      Residence_Addresses_City: orNull(f[idx('Residence_Addresses_City')]),
      Residence_Addresses_Zip: orNull(f[idx('Residence_Addresses_Zip')]),
      Residence_Addresses_State: 'IL',
      Residence_Addresses_AddressLine: [
        orNull(f[idx('Residence_Addresses_HouseNumber')]),
        orNull(f[idx('Residence_Addresses_PrefixDirection')]),
        orNull(f[idx('Residence_Addresses_StreetName')]),
        orNull(f[idx('Residence_Addresses_Designator')]),
      ]
        .filter(Boolean)
        .join(' '),
      Parties_Description: orNull(f[idx('Parties_Description')]),
      Age_Int: Number.isNaN(age) ? null : age,
      Gender: roll % 20 === 0 ? null : roll % 2 === 0 ? 'M' : 'F',
      Voter_Status: VOTER_STATUSES[roll % VOTER_STATUSES.length] ?? null,
      // Raw values drawn from the vocab VALUE_MAPPERS accepts, so every
      // pack dim and saved-filter option has data to bite on locally.
      Estimated_Income_Amount_Int:
        roll % 6 === 0 ? null : 15_000 + (roll % 22) * 10_000,
      // Raw L2 vocabulary (the VALUE_MAPPERS switch RETURN values in
      // people-api filters.sql.utils.ts) — the filter-side names don't
      // exist in the column and would bucket everything as Unknown.
      Marital_Status: [
        'Married',
        'Single',
        'Inferred Married',
        'Inferred Single',
        null,
      ][roll % 5] as string | null,
      Veteran_Status: roll % 8 === 0 ? 'Yes' : null,
      Presence_Of_Children: ['Y', 'N', null][roll % 3] as string | null,
      Homeowner_Probability_Model: [
        'Home Owner',
        'Probable Home Owner',
        'Renter',
        null,
      ][roll % 4] as string | null,
      Business_Owner: roll % 9 === 0 ? 'Yes' : null,
      Education_Of_Person: [
        'Completed High School Likely',
        'Attended But Did Not Complete College Likely',
        'Completed College Likely',
        'Completed Graduate School Likely',
        null,
      ][roll % 5] as string | null,
      Language_Code: ['English', 'English', 'English', 'Spanish', null][
        roll % 5
      ] as string | null,
      EthnicGroups_EthnicGroup1Desc: [
        'European',
        'Hispanic and Portuguese',
        'Likely African-American',
        'East and South Asian',
        'Other',
        null,
      ][roll % 6] as string | null,
      StateVoterID: roll % 10 === 0 ? null : `IL${lalVoterId.slice(-9)}`,
      VoterTelephones_CellPhoneFormatted:
        roll % 5 < 3 ? `(312) 555-${String(roll % 10_000).padStart(4, '0')}` : null,
      VoterTelephones_LandlineFormatted:
        roll % 7 === 0 ? `(773) 555-${String(roll % 10_000).padStart(4, '0')}` : null,
    })

    if (batch.length >= BATCH) await flush()
  }
  await flush()

  console.log('')
  console.log(`District id: ${district.id}`)
  console.log(
    `Read ${read.toLocaleString()} CSV rows, inserted ${inserted.toLocaleString()} voters${ALL ? ' (full city)' : ' (bbox slice)'}`,
  )
  console.log('')
  console.log('Point your gp-api org at the district:')
  console.log(
    `  UPDATE organization SET override_district_id = '${district.id}' WHERE slug = '<your-org-slug>';`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
