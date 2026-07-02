import { stripHtml } from 'string-strip-html'
import { Website, WebsiteIssue } from 'helpers/types'
import {
  MIN_BIO_LENGTH,
  isGenuineBioPlainText,
  hasGenuineIssue,
} from '@goodparty_org/contracts'

export { MIN_BIO_LENGTH }
export const MIN_POLICY_FOCUS_LENGTH = 100
export const MIN_POLICY_PRIORITIES = 1

// The "why are you running?" instruction, shared by every surface that edits
// the website bio: the Campaign Story page, the Pro-upgrade candidate profile,
// and the campaign-details WhyRunningSection. One source so the prompt reads
// identically wherever the candidate writes their why.
export const WHY_RUNNING_PROMPT =
  'The moment, the people, the breaking point: your stump-speech opener.'

export const getBioPlainLength = (rawBio: string | undefined | null): number =>
  rawBio ? stripHtml(rawBio).result.trim().length : 0

/**
 * Error message for the bio ("Why are you running?") field, or null when the
 * bio meets the minimum length. Consumed by every surface that gates a
 * Submit/Save on the bio so the copy stays consistent.
 */
export const getBioError = (
  bioPlainLength: number,
  rawBio?: string | null,
): string | null => {
  if (bioPlainLength === 0) return 'Please add your bio'
  if (bioPlainLength < MIN_BIO_LENGTH) {
    return `Your bio requires ${MIN_BIO_LENGTH} characters`
  }
  // Match the API's genuineness gate: a long-enough bio that is still the
  // fallback template must be rejected in-form, not silently saved and then
  // blocked by isCandidateProfileComplete with no explanation.
  if (rawBio && !isGenuineBioPlainText(stripHtml(rawBio).result.trim())) {
    return 'Please write your bio in your own words'
  }
  return null
}

/**
 * Error message for the policy-priorities requirement, or null when at least
 * one GENUINE priority exists. Matches isCandidateProfileComplete /
 * hasGenuineIssue so the form doesn't accept a lone placeholder-titled issue
 * that the completeness check (and API) then reject — which would loop the
 * user back to the wizard with no visible error.
 */
export const getPolicyPrioritiesError = (
  issues: { title?: string | null; description?: string | null }[] | null,
): string | null =>
  hasGenuineIssue(issues) ? null : 'Please add at least one policy priority'

export interface PolicyFormValidation {
  titleInvalid: boolean
  focusInvalid: boolean
  message: string | null
}

/**
 * Validation state for the policy-priority form (title + focus). `message`
 * mirrors the Figma error states: missing fields are surfaced as "Please add
 * a ..." and a present-but-too-short focus as "Policy focus requires N
 * characters". `titleInvalid` / `focusInvalid` drive the red field borders.
 */
export const getPolicyFormValidation = (
  trimmedTitleLength: number,
  focusPlainLength: number,
): PolicyFormValidation => {
  const titleInvalid = trimmedTitleLength === 0
  const focusInvalid = focusPlainLength < MIN_POLICY_FOCUS_LENGTH

  const missing: string[] = []
  if (titleInvalid) missing.push('Policy title')
  if (focusPlainLength === 0) missing.push('Policy focus')

  let message: string | null = null
  if (missing.length === 2) {
    message = 'Please add a Policy title and Policy focus'
  } else if (titleInvalid && focusInvalid && focusPlainLength > 0) {
    // Title is empty AND the focus has content but is too short: both fields
    // render red, so the message must explain both, not just the empty title.
    message = `Please add a Policy title. Policy focus requires ${MIN_POLICY_FOCUS_LENGTH} characters`
  } else if (missing.length === 1) {
    message = `Please add a ${missing[0]}`
  } else if (focusInvalid) {
    message = `Policy focus requires ${MIN_POLICY_FOCUS_LENGTH} characters`
  }

  return { titleInvalid, focusInvalid, message }
}

export const normalizeIssues = (
  raw: { title?: string; description?: string }[] | undefined,
): WebsiteIssue[] =>
  (raw ?? []).map((i) => ({
    title: i.title ?? '',
    description: i.description ?? '',
  }))

export const isCandidateProfileComplete = (
  website: Website | null | undefined,
): boolean => {
  const bio = website?.content?.about?.bio
  const plainBio = bio ? stripHtml(bio).result.trim() : ''
  return (
    isGenuineBioPlainText(plainBio) &&
    hasGenuineIssue(website?.content?.about?.issues)
  )
}
