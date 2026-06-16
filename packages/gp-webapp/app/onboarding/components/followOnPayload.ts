import type { APIEndpoints } from 'gpApi/api-endpoints'
import type { CampaignDetails } from 'helpers/types'
import type { OnboardingAnswers, SelectedOffice } from './onboardingTypes'

export type FollowOnPayload =
  APIEndpoints['POST /v1/campaigns/follow-on']['Request']

const buildOfficeDetails = (office: SelectedOffice): CampaignDetails => ({
  electionId: office.electionId,
  raceId: office.raceId,
  state: office.state,
  city: office.city,
  district: '',
  officeTermLength: office.officeTermLength,
  ballotLevel: office.level,
  primaryElectionDate: office.primaryElectionDate,
  electionDate: office.electionDay,
  partisanType: office.partisanType,
  filingPeriodsStart: office.filingPeriodsStart,
  filingPeriodsEnd: office.filingPeriodsEnd,
})

const buildManualDetails = (
  form: NonNullable<OnboardingAnswers['manualOfficeForm']>,
): CampaignDetails => ({
  raceId: null,
  electionId: null,
  primaryElectionDate: '',
  filingPeriodsStart: null,
  filingPeriodsEnd: null,
  state: form.state,
  city: form.city,
  district: form.district,
  officeTermLength: form.officeTermLength,
  electionDate: form.electionDate,
})

// Maps the collected onboarding answers to the follow-on create body. The
// server inherits the position for same-office (from the org slug); for
// new-office it takes the picked structured position or the manual office.
export const buildFollowOnPayload = (
  answers: OnboardingAnswers,
): FollowOnPayload => {
  if (answers.followOnIntent === 'same-office') {
    return {
      intent: 'same-office',
      fromOrganizationSlug: answers.fromOrganizationSlug,
    }
  }
  if (answers.officePath === 'manual') {
    return {
      intent: 'new-office',
      customPositionName: answers.manualOfficeForm?.office,
      details: answers.manualOfficeForm
        ? buildManualDetails(answers.manualOfficeForm)
        : undefined,
    }
  }
  return {
    intent: 'new-office',
    ballotReadyPositionId: answers.structuredOffice?.positionId,
    details: answers.structuredOffice
      ? buildOfficeDetails(answers.structuredOffice)
      : undefined,
  }
}
