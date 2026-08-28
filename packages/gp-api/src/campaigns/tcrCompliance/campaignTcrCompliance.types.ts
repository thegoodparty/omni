import { CreateTcrComplianceDto } from './schemas/createTcrComplianceDto.schema'
import { CreateAgenticTcrComplianceDto } from './schemas/createAgenticTcrComplianceDto.schema'

export type CreateTcrCompliancePayload = Omit<
  CreateTcrComplianceDto,
  'placeId' | 'formattedAddress' | 'candidateName'
> & {
  placeId?: never
  formattedAddress?: never
  // Widened to allow reads off a persisted TcrCompliance record: rows
  // created before this column existed have no candidateName. The DTO
  // itself still requires it on write.
  candidateName?: string | null
}

export type CreateAgenticTcrCompliancePayload = CreateAgenticTcrComplianceDto
