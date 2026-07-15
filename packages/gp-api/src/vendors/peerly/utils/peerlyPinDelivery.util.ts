import {
  PinDeliveryMethod,
  PinDeliveryMethodSchema,
} from '@goodparty_org/contracts'
import { PeerlyCvVerificationData } from '../peerly.types'

// The channel Peerly used plus the raw destination it sent the PIN to. The
// raw destination is persisted on the TcrCompliance record and synced to
// HubSpot via the PIN Sent event so Campaign Success can name the exact
// inbox/number in the nudge (CV may deliver to a treasurer's contact from the
// state filing, not the candidate's own). Callers that return it to the
// browser still mask it via maskPinDeliveryDestination first.
export interface DerivedPinDelivery {
  method: PinDeliveryMethod
  destination: string
}

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
): DerivedPinDelivery | null => {
  const method = PinDeliveryMethodSchema.safeParse(
    data?.verification_method?.trim().toLowerCase(),
  )
  if (!method.success) {
    return null
  }
  const destination = destinationForMethod(method.data, data!)
  return destination ? { method: method.data, destination } : null
}

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@')
  if (!domain || !local) {
    return email
  }
  return `${local.slice(0, 1)}•••@${domain}`
}

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) {
    return phone
  }
  const last4 = digits.slice(-4)
  const area = digits.length >= 10 ? digits.slice(-10, -7) : ''
  return area ? `(${area}) •••-${last4}` : `•••-${last4}`
}

// A browser-safe rendering of the destination for the compliance-state read:
// the raw filing email/phone is masked and the postal address is dropped
// entirely, so the unredacted value never leaves the API.
export const maskPinDeliveryDestination = ({
  method,
  destination,
}: DerivedPinDelivery): string => {
  switch (method) {
    case PinDeliveryMethod.email:
      return maskEmail(destination)
    case PinDeliveryMethod.text:
    case PinDeliveryMethod.phone:
    case PinDeliveryMethod.call:
      return maskPhone(destination)
    case PinDeliveryMethod.mail:
      return 'your address on file'
  }
}
