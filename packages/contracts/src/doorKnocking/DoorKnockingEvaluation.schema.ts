import { z } from 'zod'
import { BboxSchema } from '../shared/Bbox.schema'
import {
  IdOverridesSchema,
  PeopleFiltersSchema,
} from '../people/PeopleFilters.schema'

// S2S gp-api → people-api: evaluate a door-knocking turf. people-api
// returns every voter matching the filters inside the bbox; gp-api then
// ray-casts the exact polygon, dedupes to unique-coordinate stops, and
// enforces the 150-stop cap. TODO(geom-index): when people_db grows a
// geometry column + GiST index, ST_Contains replaces the bbox prefilter
// inside people-api with no change to this contract.
export const DoorKnockingEvaluateRequestSchema = z
  .object({
    districtId: z.guid(),
    bbox: BboxSchema,
    filters: PeopleFiltersSchema.optional(),
    // The two id-set clauses that travel beside `filters` rather than inside
    // it, mirroring the CRM read path: `idOverrides` carries per-person
    // voter-likelihood overrides (OR-ed against the voterStatus clause
    // only), `contactsMadeIdOverrides` the mixed "0 plus a non-zero bucket"
    // contacts-made case that can't collapse into `filters.id`. A saved list
    // knocked without these applies a different audience than the same list
    // previewed in Contacts.
    idOverrides: IdOverridesSchema.optional(),
    contactsMadeIdOverrides: IdOverridesSchema.optional(),
    // A guard, not pagination: people-api rejects the request outright when
    // the bbox holds more matches than this, so a city-sized polygon can't
    // stream a whole voter file. gp-api sizes it from the 150-stop cap times
    // observed voters-per-stop, with headroom.
    maxPeople: z.number().int().positive().max(50_000),
  })
  .strict()

export type DoorKnockingEvaluateRequest = z.infer<
  typeof DoorKnockingEvaluateRequestSchema
>

// Lean by design: the roster preview needs names, and the freeze stores
// only personId/name/addressKey — age/party are always served live via the
// residents-by-address call, never from evaluation output.
export const DoorKnockingEvaluatedPersonSchema = z.object({
  id: z.guid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  // people-api's household grouping key (HOUSEHOLD_KEY_RESIDENCE_COLUMNS
  // normalization). Opaque to gp-api: stored on stop targets at freeze and
  // echoed back in residents-by-address requests.
  addressKey: z.string().min(1),
  // Residence_Addresses_AddressLine verbatim — people_db's own display
  // format, never re-composed downstream.
  displayAddress: z.string(),
})

export type DoorKnockingEvaluatedPerson = z.infer<
  typeof DoorKnockingEvaluatedPersonSchema
>

export const DoorKnockingEvaluateResponseSchema = z.object({
  people: z.array(DoorKnockingEvaluatedPersonSchema),
})

export type DoorKnockingEvaluateResponse = z.infer<
  typeof DoorKnockingEvaluateResponseSchema
>
