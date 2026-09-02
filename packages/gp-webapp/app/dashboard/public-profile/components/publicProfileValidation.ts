// Contact-field validation for the public profile editor.
//
// The whole profile is saved as one payload, so a single malformed contact
// field rejects every other edit in the form. That made a bad value effectively
// permanent: the save failed, the toast said "try again", and retrying could
// never work. These helpers catch the two formats the API is strict about
// before a request is spent, and translate a rejection back onto the field that
// caused it.

export const URL_FIELDS = [
  'websiteUrl',
  'governmentWebsiteUrl',
  'instagramUrl',
  'tiktokUrl',
  'facebookUrl',
  'twitterUrl',
  'linkedinUrl',
] as const

export type UrlField = (typeof URL_FIELDS)[number]

export type FieldErrors = Partial<Record<string, string>>

const FIELD_LABELS: Record<string, string> = {
  publicEmail: 'Public email',
  websiteUrl: 'Personal website',
  governmentWebsiteUrl: 'Government website',
  instagramUrl: 'Instagram',
  tiktokUrl: 'TikTok',
  facebookUrl: 'Facebook',
  twitterUrl: 'X / Twitter',
  linkedinUrl: 'LinkedIn',
}

export const GENERIC_SAVE_ERROR =
  "Couldn't save your profile. Please try again."

/**
 * Adds the scheme the API requires. Someone filling in a field labelled
 * "Instagram" types `instagram.com/jane`, which the server rejects outright, so
 * the missing half is supplied rather than held against them.
 */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.includes('.')
    )
  } catch {
    return false
  }
}

// Deliberately looser than the server's rule. A false accept costs one
// round-trip that now names the offending field, whereas a false reject would
// block a deliverable address from the client with no way around it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Blank is always valid: the editor sends `null` for an empty field and every
 * rule on the server is nullable, so clearing a field must never be an error.
 */
export function validateContact(form: Record<string, string>): FieldErrors {
  const errors: FieldErrors = {}

  const email = form.publicEmail?.trim() ?? ''
  if (email !== '' && !EMAIL_RE.test(email)) {
    errors.publicEmail = 'Enter a valid email address, like you@example.com.'
  }

  for (const key of URL_FIELDS) {
    const raw = form[key]?.trim() ?? ''
    if (raw === '') continue
    if (!isValidUrl(normalizeUrl(raw))) {
      errors[key] = 'Enter a valid link, like https://example.com/you.'
    }
  }

  return errors
}

/**
 * Recovers per-field messages from a rejected save. The body is walked rather
 * than read at a fixed key so that a change to the server's error shape falls
 * back to the generic message instead of throwing inside the error handler.
 */
export function fieldErrorsFromApiError(err: unknown): FieldErrors {
  const body = (err as { data?: unknown } | null | undefined)?.data
  const errors: FieldErrors = {}

  const visit = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > 4) return
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) visit(item, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    const path: unknown = record.path
    const field: unknown = Array.isArray(path)
      ? (path as unknown[])[0]
      : undefined
    if (
      typeof field === 'string' &&
      typeof record.message === 'string' &&
      errors[field] === undefined
    ) {
      errors[field] = record.message
    }
    for (const value of Object.values(record)) visit(value, depth + 1)
  }

  visit(body, 0)
  return errors
}

/** Names the fields to fix, so the message is actionable rather than generic. */
export function summarize(errors: FieldErrors): string {
  const labels = Object.keys(errors).map((key) => FIELD_LABELS[key] ?? key)
  if (labels.length === 0) return GENERIC_SAVE_ERROR
  if (labels.length === 1) return `Check ${labels[0]} and save again.`
  const last = labels[labels.length - 1]
  return `Check ${labels.slice(0, -1).join(', ')} and ${last}, then save again.`
}
