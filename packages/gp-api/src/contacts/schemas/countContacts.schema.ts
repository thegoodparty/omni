import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The in-progress, unsaved filter set the segment builder is showing. Same
// field shape the create/update filter endpoints persist, so the live count
// runs the identical filter translation the saved segment would (ENG-10517).
const countContactsSchema = voterFilterBaseSchema.extend({
  // The saved list being edited, when there is one. Its DRAWN BOUNDARY is
  // the only thing read from it — every filter field still comes from the
  // body, because those are exactly what the holder is editing.
  //
  // Without this the edit wizard counted a boundaried list at its
  // pre-boundary size: the wizard spreads the saved row's fields inline, and
  // an inline filter carries neither an `id` nor a `geoPoly`, so the geo
  // resolution saw no boundary and answered "no constraint". A list reading
  // 339 on its detail sheet offered "Save changes (5,356)" one click away.
  //
  // A bare id from the client, so it is resolved through the org-scoped
  // segment lookup that 404s anything this organization does not own.
  boundaryFromSegmentId: z.coerce.number().int().positive().optional(),
})

export class CountContactsDTO extends createZodDto(countContactsSchema) {}
