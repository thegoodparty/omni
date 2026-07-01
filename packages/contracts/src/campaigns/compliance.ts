// The candidate bio ("why are you running?") minimum length, measured on
// plain text (HTML stripped). Shared so the gp-api website publish gate and
// the gp-webapp candidate-profile form enforce the identical threshold — a
// divergence would let a candidate author a bio one side accepts and the
// other rejects.
export const MIN_BIO_LENGTH = 500

// The agentic compliance flow's old fallback copy. Peerly rejects it as "not
// genuine", so the publish gate, the Peerly-submit gate, and the webapp's
// profile-complete check all treat it as not-genuine. Shared here so the API
// and the webapp agree on exactly what "generic" means.
export const TEMPLATE_BIO_MARKER =
  'running on local solutions over party politics'
export const COMPLIANCE_DEFAULT_ISSUE_TITLE =
  'Local Solutions, Not Party Politics'

// Genuine bio = long enough AND not the fallback template. `plainText` must be
// HTML-stripped by the caller (gp-api strips with serializeWebsiteBio, the
// webapp with stripHtml) so the length and marker checks run on real text.
export const isGenuineBioPlainText = (plainText: string): boolean =>
  plainText.trim().length >= MIN_BIO_LENGTH &&
  !plainText.toLowerCase().includes(TEMPLATE_BIO_MARKER)

// A genuine issue has a real title AND description and is not the fallback
// default. Guards a non-null object because website content is a JSON column
// that can carry a malformed entry. Shared so the publish gate, the fallback's
// "keep valid issues" filter, and the webapp all agree on what counts.
export const isGenuineIssue = (
  issue?: { title?: string | null; description?: string | null } | null,
): boolean =>
  typeof issue === 'object' &&
  issue !== null &&
  (issue.title?.trim().length ?? 0) > 0 &&
  (issue.description?.trim().length ?? 0) > 0 &&
  issue.title?.trim() !== COMPLIANCE_DEFAULT_ISSUE_TITLE

// Genuine issues = at least one genuine issue.
export const hasGenuineIssue = (
  issues?: { title?: string | null; description?: string | null }[] | null,
): boolean => (issues ?? []).some(isGenuineIssue)
