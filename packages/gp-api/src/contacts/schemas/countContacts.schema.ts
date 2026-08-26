import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The in-progress, unsaved filter set the segment builder is showing. Same
// field shape the create/update filter endpoints persist, so the live count
// runs the identical filter translation the saved segment would (ENG-10517).
//
// hasAnyPhone is count-only and deliberately NOT in voterFilterBaseSchema:
// it is not a persisted VoterFileFilter column, only a people-db filter key
// (cell OR landline non-null). Phone banking's builder count sends it as an
// overlay so the running total matches who the freeze will actually keep
// (ENG-10957) — the default z.object would silently strip it here otherwise.
export class CountContactsDTO extends createZodDto(
  voterFilterBaseSchema.extend({ hasAnyPhone: z.boolean().optional() }),
) {}
