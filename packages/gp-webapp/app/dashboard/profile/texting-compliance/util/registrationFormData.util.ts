import { z } from 'zod'
import { clientFetch } from 'gpApi/clientFetch'
import type { ApiRoute } from 'gpApi/routes'
import type { FormDataState } from '@shared/hooks/useFormData'
import {
  mapFormData,
  type ManualAddress,
} from 'app/dashboard/profile/texting-compliance/util/mapFormData.util'

export interface RegistrationFormData {
  electionFilingLink: string
  campaignCommitteeName: string
  candidateName: string
  officeLevel: string
  ein: string
  phone: string
  address: { formatted_address: string; place_id: string }
  manualAddress?: ManualAddress
  website: string
  email: string
  fecCommitteeId?: string
  committeeType?: string
}

export const isAddressValue = (
  value: FormDataState[keyof FormDataState] | undefined,
): value is RegistrationFormData['address'] =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'formatted_address' in value &&
    'place_id' in value,
  )

export const isManualAddressValue = (
  value: FormDataState[keyof FormDataState] | undefined,
): value is ManualAddress =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'addressLine1' in value &&
    'city' in value &&
    'state' in value &&
    'zip' in value,
  )

export const toRegistrationFormData = (
  formData: FormDataState,
): RegistrationFormData => ({
  electionFilingLink: String(formData.electionFilingLink || ''),
  campaignCommitteeName: String(formData.campaignCommitteeName || ''),
  candidateName: String(formData.candidateName || ''),
  officeLevel: String(formData.officeLevel || ''),
  ein: String(formData.ein || ''),
  phone: String(formData.phone || ''),
  address: isAddressValue(formData.address)
    ? formData.address
    : { formatted_address: '', place_id: '' },
  manualAddress: isManualAddressValue(formData.manualAddress)
    ? formData.manualAddress
    : undefined,
  website: String(formData.website || ''),
  email: String(formData.email || ''),
  fecCommitteeId: formData.fecCommitteeId
    ? String(formData.fecCommitteeId)
    : undefined,
  committeeType: formData.committeeType
    ? String(formData.committeeType)
    : undefined,
})

// nestjs-zod's ZodValidationException 400 body: the actionable detail lives in
// errors[].message, while `message` itself is the constant 'Validation
// failed'. Other HttpExceptions carry their detail in `message`.
const errorBodySchema = z.object({
  message: z.string().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
})

const extractServerMessage = (data: unknown): string | null => {
  const parsed = errorBodySchema.safeParse(data)
  if (!parsed.success) return null
  const issueMessages = parsed.data.errors?.map((issue) => issue.message) ?? []
  if (issueMessages.length > 0) return issueMessages.join('; ')
  const { message } = parsed.data
  return message && message !== 'Validation failed' ? message : null
}

// Thrown with the server's own rejection message when the response carries
// one (e.g. the Zod check rejecting an FEC.gov filing URL for a non-federal
// office level), so callers can show the candidate the actual reason instead
// of a generic "try again later" (ENG-11043). Callers must still fall back to
// their generic copy for anything that isn't this error.
export class TcrComplianceSubmitError extends Error {}

export const submitTcrCompliance = async (
  route: ApiRoute,
  formData: RegistrationFormData,
  errorMessage = 'Failed to submit TCR compliance',
): Promise<unknown> => {
  const mappedData = mapFormData(formData)
  const response = await clientFetch(route, mappedData)
  if (!response.ok) {
    throw new TcrComplianceSubmitError(
      extractServerMessage(response.data) ?? errorMessage,
    )
  }
  return response.data
}
