const SERVE_ISSUE_CAPTURE_FLAG = 'serve-issue-capture'
const WIN_ISSUE_CAPTURE_FLAG = 'win-issue-capture'

// Each product rolls out on its own key, chosen by the org's product: an
// `eo-` slug is an elected official's office, anything else a campaign.
export const issueCaptureFlagFor = (organizationSlug: string): string =>
  organizationSlug.startsWith('eo-')
    ? SERVE_ISSUE_CAPTURE_FLAG
    : WIN_ISSUE_CAPTURE_FLAG
