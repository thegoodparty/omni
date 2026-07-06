import { z } from 'zod'

const toEnumObject = <const T extends readonly string[]>(
  values: T,
): { [K in T[number]]: K } =>
  Object.fromEntries(values.map((v) => [v, v])) as { [K in T[number]]: K }

export const BALLOT_READY_POSITION_LEVEL_VALUES = [
  'CITY',
  'COUNTY',
  'FEDERAL',
  'LOCAL',
  'REGIONAL',
  'STATE',
  'TOWNSHIP',
] as const
export type BallotReadyPositionLevel =
  (typeof BALLOT_READY_POSITION_LEVEL_VALUES)[number]
export const BallotReadyPositionLevelSchema = z.enum(
  BALLOT_READY_POSITION_LEVEL_VALUES,
)
export const BallotReadyPositionLevel = toEnumObject(
  BALLOT_READY_POSITION_LEVEL_VALUES,
)

export const ELECTION_LEVEL_VALUES = [
  'state',
  'county',
  'federal',
  'city',
] as const
export type ElectionLevel = (typeof ELECTION_LEVEL_VALUES)[number]
export const ElectionLevelSchema = z.enum(ELECTION_LEVEL_VALUES)
export const ElectionLevel = toEnumObject(ELECTION_LEVEL_VALUES)

export const CAMPAIGN_CREATED_BY_VALUES = ['admin'] as const
export type CampaignCreatedBy = (typeof CAMPAIGN_CREATED_BY_VALUES)[number]
export const CampaignCreatedBySchema = z.enum(CAMPAIGN_CREATED_BY_VALUES)
export const CampaignCreatedBy: { ADMIN: 'admin' } = { ADMIN: 'admin' }

export const CAMPAIGN_LAUNCH_STATUS_VALUES = ['launched'] as const
export type CampaignLaunchStatus =
  (typeof CAMPAIGN_LAUNCH_STATUS_VALUES)[number]
export const CampaignLaunchStatusSchema = z.enum(
  CAMPAIGN_LAUNCH_STATUS_VALUES,
)
export const CampaignLaunchStatus = toEnumObject(
  CAMPAIGN_LAUNCH_STATUS_VALUES,
)

export const CAMPAIGN_STATUS_VALUES = ['candidate', 'onboarding'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUS_VALUES)[number]
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUS_VALUES)
export const CampaignStatus = toEnumObject(CAMPAIGN_STATUS_VALUES)

export const ONBOARDING_STEP_VALUES = [
  'onboarding-complete',
  'registration',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEP_VALUES)[number]
export const OnboardingStepSchema = z.enum(ONBOARDING_STEP_VALUES)
export const OnboardingStep: {
  complete: 'onboarding-complete'
  registration: 'registration'
} = {
  complete: 'onboarding-complete',
  registration: 'registration',
}

export const GENERATION_STATUS_VALUES = ['processing', 'completed'] as const
export type GenerationStatus = (typeof GENERATION_STATUS_VALUES)[number]
export const GenerationStatusSchema = z.enum(GENERATION_STATUS_VALUES)
export const GenerationStatus = toEnumObject(GENERATION_STATUS_VALUES)

export const ORGANIZATION_STATUS_VALUES = ['active', 'past'] as const
export type OrganizationStatus = (typeof ORGANIZATION_STATUS_VALUES)[number]
export const OrganizationStatusSchema = z.enum(ORGANIZATION_STATUS_VALUES)
export const OrganizationStatus = toEnumObject(ORGANIZATION_STATUS_VALUES)

export const COMPLIANCE_STAGE_VALUES = [
  'needs_profile',
  'needs_filing',
  'pending_domain_purchase',
  'pending_website_live',
  'awaiting_pin',
  'tcr_in_review',
  'tcr_approved',
  'tcr_rejected',
] as const
export type ComplianceStage = (typeof COMPLIANCE_STAGE_VALUES)[number]
export const ComplianceStageSchema = z.enum(COMPLIANCE_STAGE_VALUES)
export const ComplianceStage = toEnumObject(COMPLIANCE_STAGE_VALUES)

// Peerly CampaignVerify (CV) states, in lifecycle order:
// REQUESTED/IN_REVIEW (no PIN issued yet) → APPROVED (PIN sent, awaiting
// entry) → VERIFIED (candidate's PIN entered; a CV token can now be minted and
// the usecase submitted — distinct from APPROVED, which the CV authority can
// reach before the candidate completes PIN entry). Mirrors the values Peerly
// returns from retrieve_cv; surfaced so the FE can gate the PIN-entry screen on
// APPROVED+. This is the single source of truth for the enum — the gp-api
// Peerly vendor layer re-exports it (vendors/peerly/peerly.types.ts).
export const PEERLY_CV_VERIFICATION_STATUS_VALUES = [
  'REQUESTED',
  'IN_REVIEW',
  'APPROVED',
  'VERIFIED',
  'REJECTED',
  'WITHDRAWN',
] as const
export type PeerlyCvVerificationStatus =
  (typeof PEERLY_CV_VERIFICATION_STATUS_VALUES)[number]
export const PeerlyCvVerificationStatusSchema = z.enum(
  PEERLY_CV_VERIFICATION_STATUS_VALUES,
)
export const PeerlyCvVerificationStatus = toEnumObject(
  PEERLY_CV_VERIFICATION_STATUS_VALUES,
)
