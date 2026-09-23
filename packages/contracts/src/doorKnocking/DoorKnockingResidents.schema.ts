import { z } from 'zod'
import { PersonSchema } from '../people/Person.schema'

// S2S gp-api → people-api: live residents-by-address enrichment for serving
// a frozen route. The route's stop targets carry addressKeys and personIds
// frozen at knock time; every serve re-reads the people behind them live so
// age/party/rosters are never stale. Only units containing a target are
// returned — targetless units at the same coordinate are dropped.
export const DoorKnockingResidentsRequestSchema = z
  .object({
    districtId: z.guid(),
    // One entry per target unit on the route (≤150 stops, multi-unit stops
    // fan out). 5,000 bounds the SQL array param far above any real route.
    addressKeys: z.array(z.string().min(1)).min(1).max(5_000),
    // The frozen targets. Residents at a requested addressKey who are NOT in
    // this set come back as otherResidents (household context, name-only).
    targetPersonIds: z.array(z.guid()).min(1).max(50_000),
  })
  .strict()

export type DoorKnockingResidentsRequest = z.infer<
  typeof DoorKnockingResidentsRequestSchema
>

// The demographic profile the door shows for a TARGET, and only a target.
// Every field here is a column already in `DOWNLOAD_COLUMNS` — the curated CSV
// gp-api hands candidates today behind the same district access check and the
// same Pro gate — so this is a new surface for existing disclosure, not new
// disclosure. Screen only: both paper surfaces omit it, for the reason they
// omit phone numbers.
//
// Value sets are **reused off `PersonSchema.shape`** rather than re-declared,
// because these are literally the same columns through the same display
// mappers (`transformToPersonOutput.util.ts`) that `/v1/contacts` person
// detail already serves. Two copies of one vocabulary is how the door starts
// wording a voter's education differently from the CRM. The values each
// mapper can emit are named in the comments below, since a reader at this
// boundary needs them and `.shape` alone doesn't show them.
export const DoorKnockingDemographicsShape = {
  // `StateVoterID IS NOT NULL`, the same derivation the exploration-map pack
  // calls `registered` (`voterPack.service.ts`). Deliberately NOT
  // `PersonSchema.shape.registeredVoter`, which is hardcoded `'Yes'` and reads
  // no column at all. A boolean rather than that schema's Yes/No enum so the
  // two can't be mistaken for each other.
  //
  // Nullable only because a route payload target who may have moved has no
  // live row to read it off. The residents response always has a row, so it
  // always answers.
  registeredVoter: z.boolean().nullable(),
  // `Voter_Status` — Super / Likely / Unreliable / Unlikely, with the file's
  // `Unknown` sentinel mapping to null. **Relabelled deliberately**: the
  // prototype called this "Voter status", meaning active/inactive
  // registration. This is turnout propensity, which is a different fact, and
  // naming it the prototype's way would name it as something it isn't.
  turnoutLikelihood: PersonSchema.shape.voterStatus,
  // `Marital_Status`. The file's `Inferred Married` / `Inferred Single` render
  // as "Likely Married" / "Likely Single" — modelled, not observed, and the
  // wording keeps that distinction visible at the door.
  maritalStatus: PersonSchema.shape.maritalStatus,
  // `Presence_Of_Children` — a HOUSEHOLD Y/N flag, not a count. There is no
  // column for the number of children.
  hasChildrenUnder18: PersonSchema.shape.hasChildrenUnder18,
  // `Veteran_Status`. **Presence-only**: `z.enum(['Yes'])`, because the column
  // holds a value meaning yes or nothing at all, so absence is
  // indistinguishable from unknown. Renderers must never print "No" — see the
  // note on `businessOwner` below.
  veteranStatus: PersonSchema.shape.veteranStatus,
  // `Homeowner_Probability_Model` — Home Owner / Probable Home Owner / Renter
  // → Yes / Likely / No. A model, not a deed record.
  homeowner: PersonSchema.shape.homeowner,
  // `Business_Owner`. **Presence-only, and the weakest of the eleven**:
  // nothing in this repo documents what strings the column holds, and every
  // consumer treats any non-null value as Yes. Like `veteranStatus`, absence
  // is unknown rather than "No", so a renderer that prints "No" states a fact
  // the data does not support.
  businessOwner: PersonSchema.shape.businessOwner,
  // `Education_Of_Person`. Every raw value ends in "Likely"; the mapper strips
  // that rather than inventing its own labels.
  levelOfEducation: PersonSchema.shape.levelOfEducation,
  // `Estimated_Income_Amount_Int` (the Int column; the string twin exists for
  // CSV download only). Sent as the raw amount and bucketed at render through
  // `INCOME_RANGE_MAPPING`, so the door never prints a spuriously precise
  // number for a modelled figure. It is HOUSEHOLD income — label it as such.
  estimatedIncomeAmount: PersonSchema.shape.estimatedIncomeAmount,
  // `Language_Code` (which holds names, not codes) → English / Spanish /
  // Other. **Nullable here where `PersonSchema`'s is not**: that mapper
  // collapses a null column to 'Other', which at the door would assert the
  // person speaks something other than English or Spanish on the strength of
  // no data. Same reasoning — and the same shape — as `politicalParty` above,
  // which stays null for an absent value while a present unrecognized one is
  // a real fact that maps to 'Other'.
  language: PersonSchema.shape.language.nullable(),
  // `EthnicGroups_EthnicGroup1Desc`. Two other ethnicity columns exist on the
  // Voter model and are used nowhere; don't reach for them.
  ethnicityGroup: PersonSchema.shape.ethnicityGroup,
} as const

export const DoorKnockingResidentTargetSchema = z.object({
  personId: z.guid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  age: z.number().nullable(),
  politicalParty: z
    .enum(['Independent', 'Democratic', 'Republican', 'Other'])
    .nullable(),
  // Same two columns the voter-file download already hands candidates as
  // "Cell Phone" and "Landline", behind the same district access check. Live
  // like age and party, so a person who moved carries no number.
  cellPhone: z.string().nullable(),
  landline: z.string().nullable(),
  ...DoorKnockingDemographicsShape,
})

export type DoorKnockingResidentTarget = z.infer<
  typeof DoorKnockingResidentTargetSchema
>

export const DoorKnockingResidentsAddressSchema = z.object({
  addressKey: z.string(),
  targets: z.array(DoorKnockingResidentTargetSchema),
  // Household context shown at the door — deliberately name-only, and that
  // holds all the way through the demographic profile above. A non-target
  // resident is context for the conversation, not someone the candidate asked
  // to contact, so widening this shape needs a product decision rather than a
  // symmetry argument.
  otherResidents: z.array(
    z.object({
      personId: z.guid(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    }),
  ),
})

export type DoorKnockingResidentsAddress = z.infer<
  typeof DoorKnockingResidentsAddressSchema
>

// addressKeys with no current residents (post-freeze churn) are simply
// absent — callers render those units from their frozen snapshots.
export const DoorKnockingResidentsResponseSchema = z.object({
  addresses: z.array(DoorKnockingResidentsAddressSchema),
})

export type DoorKnockingResidentsResponse = z.infer<
  typeof DoorKnockingResidentsResponseSchema
>
