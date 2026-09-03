import { z } from 'zod'

// Both of the daily allowances a create has to clear, read together because
// they are two independent ceilings on one press: an organization can be well
// inside its stop budget and still be refused for having cut five turfs
// today, and it can be on its first turf of the day and still be refused for
// the size of it. A client holding only one of the two numbers would disable
// the wrong control, or none.
//
// The limits ride along with the remainders rather than being constants the
// client keeps its own copy of. The waypoint one is genuinely per
// organization — an admin can raise a single org — so a hardcoded 500 would
// be wrong for exactly the orgs that were raised, and a hardcoded 5 would be
// a second place to edit the day the campaign limit moves.
//
// Advisory, the same way the address preview's own `waypointsRemaining` is:
// the two asserts inside the create transaction are the authority, and a
// teammate's turf can spend either allowance between this read and the press.
export const DoorKnockingQuotaResponseSchema = z.object({
  campaignsRemaining: z.number().int().nonnegative(),
  campaignLimit: z.number().int().positive(),
  waypointsRemaining: z.number().int().nonnegative(),
  waypointLimit: z.number().int().positive(),
})

export type DoorKnockingQuotaResponse = z.infer<
  typeof DoorKnockingQuotaResponseSchema
>
