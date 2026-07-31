'use client'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FormDataProvider, FormDataState } from '@shared/hooks/useFormData'
import { useUser } from '@shared/hooks/useUser'
import { useCampaign } from '@shared/hooks/useCampaign'
import { apiRoutes } from 'gpApi/routes'
import { useSnackbar } from 'helpers/useSnackbar'
import { Website } from 'helpers/types'
import { TCR_COMPLIANCE_QUERY_KEY } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import {
  submitTcrCompliance,
  toRegistrationFormData,
} from 'app/dashboard/profile/texting-compliance/util/registrationFormData.util'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { isCandidateProfileComplete } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { useCandidateProfileForm } from 'app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm'
import CandidateProfileFields from 'app/dashboard/profile/texting-compliance/candidate-profile/components/CandidateProfileFields'
import TextingComplianceRegistrationForm, {
  validateRegistrationForm,
} from 'app/dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm'

const validateAgenticForm = (data: FormDataState) =>
  validateRegistrationForm(data, { requireWebsite: false })

export default function ElectionFiling(): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, , userLoading] = useUser()
  const [campaign] = useCampaign()
  const { errorSnackbar, successSnackbar } = useSnackbar()

  const [loading, setLoading] = useState(false)
  const [hasSubmissionError, setHasSubmissionError] = useState(false)

  const { data: website, isSuccess: websiteLoaded } = useQuery<Website | null>({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })
  // Captured once when the website query settles, not derived live: the
  // profile save invalidates the website query, and a live derivation would
  // unmount the half-submitted section mid-flight on the refetch. `null`
  // means "not settled yet" and gates `ready` below.
  const [needsProfile, setNeedsProfile] = useState<boolean | null>(null)
  useEffect(() => {
    if (needsProfile !== null || !websiteLoaded) return
    setNeedsProfile(!isCandidateProfileComplete(website))
  }, [needsProfile, websiteLoaded, website])

  // onSaved is a no-op: the save is chained inside handleFormSubmit (via the
  // boolean handleSubmit result), not followed by navigation like the other
  // consumers.
  const profileForm = useCandidateProfileForm({ onSaved: () => undefined })

  const ready =
    !userLoading && Boolean(user) && Boolean(campaign) && needsProfile !== null

  // Funnel "viewed" event for the agentic compliance flow (ENG-10294). Fire
  // only once the form is actually shown — the form is gated behind `ready`, so
  // a bare mount event would count users who only see the Loading… spinner. The
  // matching "submitted" signal is the existing RegistrationSubmitted event in
  // handleFormSubmit.
  const filingViewTrackedRef = useRef(false)
  useEffect(() => {
    if (!ready || filingViewTrackedRef.current) return
    filingViewTrackedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingDetailsViewed)
  }, [ready])

  const handleFormSubmit = async (formData: FormDataState) => {
    setLoading(true)
    setHasSubmissionError(false)
    try {
      if (needsProfile) {
        // Persist the profile before createAgentic: for already-Pro campaigns
        // that call dispatches the compliance agent inline, and a run kicked
        // off without a genuine bio/issues fails terminally
        // (profile_incomplete). The hook surfaces its own errors (validation
        // alert / snackbar) and resolves false, which blocks the filing
        // submit.
        const profileSaved = await profileForm.handleSubmit()
        if (!profileSaved) {
          if (profileForm.bioError || profileForm.prioritiesError) {
            // The validation alert renders at the top of the profile section,
            // likely above the fold when the user submits from the bottom of
            // the registration form.
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }
          return
        }
        // The profile is persisted; hide the section so a retry after a
        // filing-submit failure goes straight to the filing (the hook latches
        // `submitting` after a successful save, so re-invoking it would
        // early-return false and dead-end the retry).
        setNeedsProfile(false)
      }
      await submitTcrCompliance(
        apiRoutes.campaign.tcrCompliance.createAgentic,
        toRegistrationFormData(formData),
        'Failed to submit election filing',
      )
      trackEvent(EVENTS.Outreach.DlcCompliance.RegistrationSubmitted, {
        // The filing email the candidate just submitted, not their account
        // email (user?.email). The two deliberately differ here (see
        // getInitialFormState), and trackEvent already attaches the account
        // email to every event by default — so this override is only useful if
        // it records the filing value. isValid gates submit on isEmail, so this
        // is always a valid non-empty string.
        email: formData.email,
        dlcComplianceStatus: 'Pending',
      })
      successSnackbar('Election filing submitted')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: TCR_COMPLIANCE_QUERY_KEY }),
      ])
      router.push('/dashboard/account')
    } catch {
      setHasSubmissionError(true)
      trackEvent(EVENTS.Outreach.DlcCompliance.RegistrationSubmitError, {
        email: formData.email,
      })
      errorSnackbar('Failed to submit election filing. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white pt-2 md:pt-4">
      <div className="mx-auto w-full max-w-2xl p-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard/account" aria-label="Back to account">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="font-medium md:text-xl">Election filing</div>
          <div>&nbsp;</div>
        </div>

        <div className="mt-10">
          {ready ? (
            <>
              {needsProfile && (
                <div className="mb-10">
                  <h2 className="text-lg font-medium">
                    Tell voters about yourself
                  </h2>
                  <p className="mt-1 mb-6 text-sm text-muted-foreground">
                    We need your candidate profile to register your campaign for
                    texting. Please be as descriptive as possible to ensure your
                    registration is approved.
                  </p>
                  <CandidateProfileFields form={profileForm} />
                </div>
              )}
              <FormDataProvider
                initialState={getInitialFormState(campaign)}
                validator={validateAgenticForm}
              >
                <TextingComplianceRegistrationForm
                  onSubmit={handleFormSubmit}
                  loading={loading}
                  hasSubmissionError={hasSubmissionError}
                  requireWebsite={false}
                />
              </FormDataProvider>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Email and phone are intentionally left blank rather than seeded from the
// candidate's GoodParty account (ENG-10290). Account contact info frequently
// does not match what is on the official campaign filing; pre-filling it led
// candidates to submit a mismatch without noticing, causing compliance
// failures. They must enter the email/phone exactly as filed. EIN and
// committee come from campaign.details, which reflect the filing, so those
// stay pre-filled.
export const getInitialFormState = (
  campaign: ReturnType<typeof useCampaign>[0],
): FormDataState => {
  const details = (campaign?.details ?? {}) as {
    einNumber?: string
    campaignCommittee?: string
  }
  return {
    electionFilingLink: '',
    campaignCommitteeName: details.campaignCommittee || '',
    officeLevel: '',
    ein: details.einNumber || '',
    phone: '',
    address: { formatted_address: '', place_id: '' },
    website: '',
    email: '',
  }
}
