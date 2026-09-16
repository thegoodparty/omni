import { z } from 'zod'

// Does this list's own filters keep anybody at all, asked without a polygon.
//
// The create flow's counts are pack arithmetic in the browser, and the pack
// encodes no support status, no previous outreach and no contacts-made. A
// list cut by one of those therefore shades as the whole district: the
// candidate draws a boundary over a map covered in matching dots, the draw
// step's Continue gate reads the same pack estimate and lets them through,
// and the audience is not resolved for real until the create — which then
// refuses, after the boundary has been drawn and named. That refusal is what
// QA reported as a valid selection being rejected.
//
// The question behind that refusal does not involve the shape. Those three
// criteria resolve to a person-id set before any polygon is looked at, and an
// empty set is empty for every polygon, so it can be answered at the who step
// the moment a list is picked — two steps earlier, and before any of the
// drawing the old message asked the candidate to redo.
//
// `empty` is deliberately the only field. The server knows the answer; which
// criteria to name belongs to the flow, which already tracks them for the
// "the map can't yet shade by X" disclosure (UNSHADEABLE_LIST_CRITERIA in the
// webapp's savedListFilters.ts). Returning a sentence here would be a second
// place to keep that copy in step.
export const DoorKnockingAudienceCheckResponseSchema = z.object({
  // True when the list's id-resolving criteria intersect to nobody.
  //
  // False is the weaker claim, and the asymmetry is the point: it means the
  // id-set resolution did not collapse, NOT that the audience is non-empty.
  // Filters with no id component — party, age, precinct — narrow a query
  // instead of resolving a set, and only the people database knows whether
  // they match. So this gate refuses a list it can prove is empty and stays
  // out of the way otherwise; the create's own 400 remains the backstop for
  // everything else.
  empty: z.boolean(),
})

export type DoorKnockingAudienceCheckResponse = z.infer<
  typeof DoorKnockingAudienceCheckResponseSchema
>
