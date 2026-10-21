import type { FormDataState } from '@shared/hooks/useFormData'
import type { WebsiteIssue } from 'helpers/types'

// What a candidate has typed into the verification form but not yet
// submitted. Nothing in the form reaches the server before the final submit,
// so without this a refresh or an Exit threw every field away. Kept in this
// browser only, per campaign, and cleared on a successful submit.
export interface VerificationDraft {
  filing?: FormDataState
  profile?: { bio: string; issues: WebsiteIssue[] }
}

const draftKey = (campaignId: number): string =>
  `campaign-verification-draft:${campaignId}`

// Storage can throw (private mode, quota, blocked site data), and the form
// must keep working without it, so every access swallows the failure.
export const readVerificationDraft = (
  campaignId: number,
): VerificationDraft | null => {
  try {
    const raw = window.localStorage.getItem(draftKey(campaignId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as VerificationDraft)
      : null
  } catch {
    return null
  }
}

export const hasVerificationDraft = (campaignId: number): boolean =>
  readVerificationDraft(campaignId) !== null

export const saveVerificationDraft = (
  campaignId: number,
  patch: VerificationDraft,
): void => {
  try {
    const next = { ...readVerificationDraft(campaignId), ...patch }
    window.localStorage.setItem(draftKey(campaignId), JSON.stringify(next))
  } catch {
    // Best effort; see above.
  }
}

export const clearVerificationDraft = (campaignId: number): void => {
  try {
    window.localStorage.removeItem(draftKey(campaignId))
  } catch {
    // Best effort; see above.
  }
}
