import { z } from 'zod'

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

export const DoorKnockingResidentTargetSchema = z.object({
  personId: z.guid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  age: z.number().nullable(),
  politicalParty: z
    .enum(['Independent', 'Democratic', 'Republican', 'Other'])
    .nullable(),
})

export type DoorKnockingResidentTarget = z.infer<
  typeof DoorKnockingResidentTargetSchema
>

export const DoorKnockingResidentsAddressSchema = z.object({
  addressKey: z.string(),
  targets: z.array(DoorKnockingResidentTargetSchema),
  // Household context shown at the door — deliberately name-only.
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
