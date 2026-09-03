import { createZodDto } from 'nestjs-zod'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The in-progress, unsaved filter set the segment builder is showing. Same
// field shape the create/update filter endpoints persist, so the live count
// runs the identical filter translation the saved segment would (ENG-10517).
export class CountContactsDTO extends createZodDto(voterFilterBaseSchema) {}
