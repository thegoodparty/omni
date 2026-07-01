import {
  COMPLIANCE_DEFAULT_ISSUE_TITLE,
  TEMPLATE_BIO_MARKER,
  hasGenuineIssue,
  isGenuineBioPlainText,
} from '@goodparty_org/contracts'
import { serializeWebsiteBio } from './serializeWebsiteBio.util'

// Genuineness rules live in @goodparty_org/contracts so the API gate and the
// webapp profile-complete check share one definition. gp-api strips the bio's
// Quill HTML to plain text first, then applies the shared length/marker rule.
export { COMPLIANCE_DEFAULT_ISSUE_TITLE, hasGenuineIssue }

// Publish-level bio bar for ALL candidate websites: a non-empty bio that is not
// the agentic fallback template. Deliberately NOT the 500-char genuineness bar
// — the general website builder has its own 100-char minimum, so requiring 500
// at the shared publish gate would break it. The 500-char genuineness
// (isBioGenuine) is a compliance-only bar enforced at the Peerly-submit gate.
export const isBioPublishable = (bio?: string | null): boolean => {
  const text = serializeWebsiteBio(bio)
  return text !== null && !text.toLowerCase().includes(TEMPLATE_BIO_MARKER)
}

export const isBioGenuine = (bio?: string | null): boolean => {
  const text = serializeWebsiteBio(bio)
  return text !== null && isGenuineBioPlainText(text)
}

export const isGenericComplianceContent = (
  content: PrismaJson.WebsiteContent | null | undefined,
): boolean =>
  !isBioGenuine(content?.about?.bio) || !hasGenuineIssue(content?.about?.issues)
