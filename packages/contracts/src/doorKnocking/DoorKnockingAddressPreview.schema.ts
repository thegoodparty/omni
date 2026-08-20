import { z } from 'zod'

// One knockable unit inside the drawn shape: the address a canvasser walks
// up to, and how many targeted voters are behind it.
//
// Deliberately narrower than the route payload's address, which carries
// names, ages, party and phones. Nothing here identifies a person: the draw
// step is answering "which houses is this?", and a candidate deciding where
// to walk does not need to be handed a roster of who lives there before they
// have committed to anything.
export const DoorKnockingPreviewDoorSchema = z.object({
  // Rendered from the unit key exactly as the frozen route renders it
  // (renderUnitAddress), so the address previewed here and the address
  // walked later are the same string rather than two formats of one place.
  address: z.string(),
  people: z.number().int().nonnegative(),
})

export type DoorKnockingPreviewDoor = z.infer<
  typeof DoorKnockingPreviewDoorSchema
>

// The doors sharing one geocoded coordinate — one stop for the router, and
// several doors for whoever knocks it. Grouped rather than flattened for the
// same reason the route freezes stops by coordinate: a block of flats is one
// place you walk to and many doors you knock.
export const DoorKnockingPreviewLocationSchema = z.object({
  doors: z.array(DoorKnockingPreviewDoorSchema).min(1),
})

export type DoorKnockingPreviewLocation = z.infer<
  typeof DoorKnockingPreviewLocationSchema
>

// The exact in-ring audience for a shape being drawn: the same evaluation the
// knock runs, minus the billed vendor call and without freezing anything.
//
// `stops`, `doors` and `people` are the three quantities `routeCounts.ts`
// defines, computed the way the freeze computes them — stops are unique
// coordinates, doors are unique unit keys within a stop, people are the
// targeted voters left after ADR 0007 and ADR 0008 suppression. Once a
// preview exists for the ring on screen these ARE the draw step's numbers;
// the pack's own estimate is not shown beside them, because the pack counts a
// different audience (it cannot shade every filter) at a different
// granularity (its households are AddressLine-level, so a block of flats is
// one). See ADR 0010.
export const DoorKnockingAddressPreviewResponseSchema = z.object({
  stops: z.number().int().nonnegative(),
  doors: z.number().int().nonnegative(),
  people: z.number().int().nonnegative(),
  // Capped at the 150-stop limit: past it the shape cannot be saved anyway,
  // so materializing more addresses buys nothing. Whole locations only, so a
  // listed stop always shows every door behind it — a truncated location
  // would report fewer doors than the building has. `locations.length` below
  // `stops` is what tells the panel it is showing a prefix.
  locations: z.array(DoorKnockingPreviewLocationSchema),
})

export type DoorKnockingAddressPreviewResponse = z.infer<
  typeof DoorKnockingAddressPreviewResponseSchema
>
