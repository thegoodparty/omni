import {
  COMPLIANCE_DEFAULT_ISSUE_TITLE,
  hasGenuineIssue,
  isGenuineBioPlainText,
} from '@goodparty_org/contracts'
import { serializeWebsiteBio } from './serializeWebsiteBio.util'

// Genuineness rules live in @goodparty_org/contracts so the API gate and the
// webapp profile-complete check share one definition. gp-api strips the bio's
// Quill HTML to plain text first, then applies the shared length/marker rule.
export { COMPLIANCE_DEFAULT_ISSUE_TITLE, hasGenuineIssue }

export const isBioGenuine = (bio?: string | null): boolean => {
  const text = serializeWebsiteBio(bio)
  return text !== null && isGenuineBioPlainText(text)
}

export const isGenericComplianceContent = (
  content: PrismaJson.WebsiteContent | null | undefined,
): boolean =>
  !isBioGenuine(content?.about?.bio) || !hasGenuineIssue(content?.about?.issues)
