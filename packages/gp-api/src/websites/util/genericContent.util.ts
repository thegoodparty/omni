import { MIN_BIO_LENGTH } from '@goodparty_org/contracts'
import { serializeWebsiteBio } from './serializeWebsiteBio.util'

// The fallback content the agentic compliance flow used to publish. Peerly
// rejects it as "not genuine", so both the publish gate and the Peerly-submit
// gate refuse it. Kept here as the single definition of what "generic" means.
export const COMPLIANCE_DEFAULT_ISSUE_TITLE =
  'Local Solutions, Not Party Politics'
export const COMPLIANCE_DEFAULT_TAGLINE = 'Local Solutions, Not Party Politics'
const TEMPLATE_BIO_MARKER = 'running on local solutions over party politics'

export const isBioGenuine = (bio?: string | null): boolean => {
  const text = serializeWebsiteBio(bio)
  if (!text || text.length < MIN_BIO_LENGTH) return false
  return !text.toLowerCase().includes(TEMPLATE_BIO_MARKER)
}

type WebsiteIssue = { title?: string | null; description?: string | null }

// content is a JSON column: legacy rows can carry a malformed (non-object,
// e.g. null) issues entry that never passed through UpdateWebsiteSchema's
// array validation, so guard each element here rather than at every call
// site. The `object` check narrows out `null` too, since `typeof null` is
// `'object'`.
export const hasGenuineIssue = (issues?: WebsiteIssue[] | null): boolean =>
  (issues ?? []).some(
    (issue) =>
      typeof issue === 'object' &&
      issue !== null &&
      (issue.title?.trim().length ?? 0) > 0 &&
      (issue.description?.trim().length ?? 0) > 0 &&
      issue.title?.trim() !== COMPLIANCE_DEFAULT_ISSUE_TITLE,
  )

export const isGenericComplianceContent = (
  content: PrismaJson.WebsiteContent | null | undefined,
): boolean =>
  !isBioGenuine(content?.about?.bio) || !hasGenuineIssue(content?.about?.issues)
