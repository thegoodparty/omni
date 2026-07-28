// Local-only door-knocking seed (untracked). Run from packages/people-api:
//
//   npx tsx seed/seedDoorKnocking.ts
//
// Creates one statewide IL district (type='State', name='IL' → people-api's
// voter-only path, so no DistrictVoter rows are needed) and ~500 voters with
// GeoMatchRooftop accuracy on a tight street grid near downtown Springfield,
// IL. Prints the district id to point your gp-api org at when done.

import { randomUUID } from 'crypto'
import { Prisma, PrismaClient } from '../src/generated/prisma'
import { voterFactory } from './factories/voter.factory'

const prisma = new PrismaClient()

// The factory drifts behind the Voter model (it still emits removed
// columns), so keep only fields the current client knows.
const VOTER_FIELDS = new Set(Object.keys(Prisma.VoterScalarFieldEnum))
const onlyModelFields = (voter: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(voter).filter(([key]) => VOTER_FIELDS.has(key)),
  ) as Prisma.VoterCreateManyInput

// Downtown Springfield, IL — arbitrary public location, nothing personal.
const CENTER = { lat: 39.8, lng: -89.65 }
const STREETS = [
  'Maple',
  'Oak',
  'Cedar',
  'Birch',
  'Walnut',
  'Chestnut',
  'Sycamore',
  'Poplar',
  'Hickory',
  'Elm',
]
const HOUSES_PER_STREET = 20

async function main() {
  const districtId = randomUUID()

  await prisma.district.upsert({
    where: { type_name_state: { type: 'State', name: 'IL', state: 'IL' } },
    update: {},
    create: { id: districtId, type: 'State', name: 'IL', state: 'IL' },
  })
  const district = await prisma.district.findUniqueOrThrow({
    where: { type_name_state: { type: 'State', name: 'IL', state: 'IL' } },
  })

  const voters = []
  for (let s = 0; s < STREETS.length; s++) {
    for (let h = 0; h < HOUSES_PER_STREET; h++) {
      // ~90m between streets, ~40m between houses — walkable turf spacing.
      const lat = (CENTER.lat + s * 0.0008).toFixed(6)
      const lng = (CENTER.lng + h * 0.0005).toFixed(6)
      const houseNumber = String(100 + h * 2)
      const streetName = STREETS[s]
      const residentsHere = 1 + ((s + h) % 3) // 1-3 voters per door

      for (let r = 0; r < residentsHere; r++) {
        voters.push(
          onlyModelFields(voterFactory({
            id: randomUUID(),
            State: 'IL',
            Residence_Addresses_LatLongAccuracy: 'GeoMatchRooftop',
            Residence_Addresses_Latitude: lat,
            Residence_Addresses_Longitude: lng,
            Residence_Addresses_HouseNumber: houseNumber,
            Residence_Addresses_StreetName: streetName,
            Residence_Addresses_Designator: 'St',
            Residence_Addresses_PrefixDirection: null,
            Residence_Addresses_SuffixDirection: null,
            Residence_Addresses_ApartmentNum: null,
            Residence_Addresses_ApartmentType: null,
            Residence_Addresses_AddressLine: `${houseNumber} ${streetName} St`,
            Residence_Addresses_City: 'Springfield',
            Residence_Addresses_State: 'IL',
            Residence_Addresses_Zip: '62701',
          })),
        )
      }
    }
  }

  const result = await prisma.voter.createMany({
    data: voters,
    skipDuplicates: true,
  })

  console.log(`District id: ${district.id}`)
  console.log(`Voters inserted: ${result.count} (${voters.length} generated)`)
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
