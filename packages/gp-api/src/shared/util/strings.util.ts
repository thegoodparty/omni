import { randomBytes } from 'crypto'
import { getRandomInt } from './numbers.util'

export const trimMany = (strings: {
  [key: string]: string
}): { [key: string]: string } =>
  Object.entries(strings).reduce(
    (acc, [key, value = '']) => ({
      ...acc,
      [key]: value.trim(),
    }),
    {},
  )

export const toLowerAndTrim = (str: string = '') => str.trim().toLowerCase()

const MAX_STRING_LENGTH = Number(process.env.MAX_STRING_LENGTH || 2048)
const CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()'
export const generateRandomString = (
  minlength = 1,
  maxLength: number = MAX_STRING_LENGTH,
) =>
  [
    ...randomBytes(
      getRandomInt(
        minlength,
        maxLength > MAX_STRING_LENGTH ? MAX_STRING_LENGTH : maxLength,
      ),
    ),
  ]
    .map((b) => CHARSET[b % CHARSET.length])
    .join('')

export function camelToSentence(text: string) {
  const result = text.replace(/([A-Z])/g, ' $1')
  return result.charAt(0).toUpperCase() + result.slice(1)
}

export function capitalizeFirstLetter(str: string): string {
  if (!str || str.length < 2) return str

  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
export const getUrlProtocol = (url: string) => {
  const result = url.match(/^[a-z][a-z0-9+\-.]*:\/\//i) // Check if URL is already prefixed with any scheme
  return result?.[0]?.toLowerCase()
}

export const ensureUrlHasProtocol = (url: string) =>
  getUrlProtocol(url) ? url : `https://${url}`

export const urlIncludesPath = (urlStr: string): boolean =>
  // optional protocol, but must have path (e.g. http://example.com/path not just http://example.com)
  /^(https?:\/\/)?[^\/\s]+\/[^\/\s]+.*$/i.test(urlStr)

// Lowercased, www-stripped host of a URL-or-domain string. isURL (used by
// UrlOrDomainSchema with require_protocol:false) is looser than the WHATWG URL
// parser, so guard the parse: an uncaught throw inside a Zod refine would
// surface as a 500 instead of a clean validation error. Returns '' on failure.
export const getUrlHostname = (urlStr: string): string => {
  try {
    const url = new URL(ensureUrlHasProtocol(urlStr))
    // Userinfo (user:pass@) makes the parser read the host from *after* the
    // '@', so a value like https://goodparty.org@sos.gov/x would report
    // sos.gov and slip a host guard. Refuse to hand back a host in that case;
    // callers reject credentialed URLs outright via urlHasCredentials.
    if (url.username || url.password) return ''
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// The WHATWG parser treats everything before an '@' as userinfo, so
// `https://goodparty.org@sos.gov/x` parses hostname `sos.gov` and would slip a
// host guard. A public filing URL never carries `user:pass@` credentials, so
// callers can reject any URL where this returns true. Returns false on parse
// failure (the field's own format validation already ran).
export const urlHasCredentials = (urlStr: string): boolean => {
  try {
    const url = new URL(ensureUrlHasProtocol(urlStr))
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

export function normalizePhoneNumber(phoneNumber: string): string {
  let cleaned = phoneNumber
    .replaceAll('+1', '')
    .replaceAll(' ', '')
    .replaceAll('-', '')
    .replaceAll('(', '')
    .replaceAll(')', '')
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.slice(1)
  }
  if (cleaned.length !== 10) {
    throw new Error(`Phone number ${phoneNumber} could not be normalized`)
  }
  return `+1${cleaned}`
}
