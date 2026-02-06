import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Formats a phone number for display using libphonenumber-js.
 * Defaults to US format if no country is detected.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'

  const phoneNumber = parsePhoneNumberFromString(phone, 'US')
  if (phoneNumber) {
    return phoneNumber.formatNational()
  }

  return phone
}
