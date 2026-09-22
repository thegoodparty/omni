// Shapes and constants this page needs.
//
// The two request/response schemas below used to be defined here, because
// `contracts/src/index.ts` was a hot file at the time. Task B2 lifted them
// into `ServeSms.schema.ts` when it built the endpoints, so this file
// re-exports them: one definition, shared by the page and by gp-api.
export {
  OutreachResultsTargetSchema,
  OutreachResultsUploadRequestSchema,
} from '@goodparty_org/contracts'
export type {
  OutreachResultsTarget,
  OutreachResultsUploadRequest,
} from '@goodparty_org/contracts'

// Checked in the browser so an oversize file gets a readable sentence rather
// than a generic body-limit failure from somewhere downstream.
//
// This must not exceed `experimental.serverActions.bodySizeLimit` in
// next.config.ts, which the upload goes through, or the check here never
// fires and the action rejects instead. The two are set to the same 5MB: a
// results file for a 10,000-recipient send is plausibly 2-3MB, so Next's 1MB
// default would have refused real work.
export const MAX_RESULTS_FILE_BYTES = 5 * 1024 * 1024

export const OUTREACH_TYPE_LABELS: Record<string, string> = {
  text: 'SMS',
  poll: 'Poll',
}

export const outreachTypeLabel = (type: string): string =>
  OUTREACH_TYPE_LABELS[type] ?? type
