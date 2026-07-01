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

export const hasGenuineIssue = (
  issues?: { title?: string | null; description?: string | null }[] | null,
): boolean =>
  (issues ?? []).some(
    (issue) =>
      (issue.title?.trim().length ?? 0) > 0 &&
      (issue.description?.trim().length ?? 0) > 0 &&
      issue.title?.trim() !== COMPLIANCE_DEFAULT_ISSUE_TITLE,
  )

export const isGenericComplianceContent = (
  content: PrismaJson.WebsiteContent | null | undefined,
): boolean =>
  !isBioGenuine(content?.about?.bio) || !hasGenuineIssue(content?.about?.issues)
