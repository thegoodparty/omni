import {
  PinDelivery,
  PinDeliveryMethod,
  PinDeliveryMethodSchema,
} from '@goodparty_org/contracts'
import { PeerlyCvVerificationData } from '../peerly.types'

const formatFilingAddress = (data: PeerlyCvVerificationData): string | null => {
  const line1 = data.filing_address_line1?.trim()
  if (!line1) {
    return null
  }
  const cityStateZip = [
    data.filing_city?.trim(),
    data.filing_state?.trim(),
    data.filing_zip?.trim(),
  ]
    .filter(Boolean)
    .join(', ')
  return [line1, data.filing_address_line2?.trim(), cityStateZip]
    .filter(Boolean)
    .join(', ')
}

const destinationForMethod = (
  method: PinDeliveryMethod,
  data: PeerlyCvVerificationData,
): string | null => {
  switch (method) {
    case PinDeliveryMethod.email:
      return data.filing_email?.trim() || null
    case PinDeliveryMethod.text:
    case PinDeliveryMethod.phone:
    case PinDeliveryMethod.call:
      return data.filing_phone_number?.trim() || null
    case PinDeliveryMethod.mail:
      return formatFilingAddress(data)
  }
}

// Normalize Peerly's `verification_data` into the channel + destination the PIN
// was sent to. Returns null when the PIN hasn't been sent (no method), the
// method is unrecognized, or the matching destination field is empty — callers
// treat null as "in progress" rather than coercing a partial value.
export const derivePinDelivery = (
  data: PeerlyCvVerificationData | null | undefined,
): PinDelivery | null => {
  const method = PinDeliveryMethodSchema.safeParse(
    data?.verification_method?.trim().toLowerCase(),
  )
  if (!method.success) {
    return null
  }
  const destination = destinationForMethod(method.data, data!)
  return destination ? { method: method.data, destination } : null
}
