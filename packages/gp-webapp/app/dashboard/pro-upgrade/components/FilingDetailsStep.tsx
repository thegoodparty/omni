'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import Body2 from '@shared/typography/Body2'
import TextField from '@shared/inputs/TextField'
import AddressAutocomplete from '@shared/AddressAutocomplete'
import {
  FormDataProvider,
  useFormData,
  type FormDataState,
} from '@shared/hooks/useFormData'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { apiRoutes } from 'gpApi/routes'
import { USER_WEBSITE_QUERY_KEY } from 'app/dashboard/website/util/website.util'
import { TCR_COMPLIANCE_QUERY_KEY } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import {
  submitTcrCompliance,
  toRegistrationFormData,
} from 'app/dashboard/profile/texting-compliance/util/registrationFormData.util'
import { StyledAlert } from '@shared/alerts/StyledAlert'
import {
  fieldDisplayNames,
  getFailingFields,
  getValidationMessage,
  validateRegistrationForm,
  type ValidationField,
} from 'app/dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm'
import {
  FecCommitteeIdInput,
  getFecCommitteeIdValidation,
} from 'app/dashboard/profile/texting-compliance/register/components/FecCommitteeIdInput'
import { checkEinSanity } from '@shared/inputs/EinSanityCheck'
import { PRO_UPGRADE_STEP, proUpgradeStepPath } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// The backend createAgentic endpoint validates officeLevel against the
// federal/state/local enum, and the federal branch additionally requires FEC
// fields. The candidate already chose an office in onboarding, so we derive the
// level from `details.ballotLevel` rather than re-asking. That value comes from
// two paths with different casing: BallotReady search stores lowercase
// `local` / `state` / `federal` (per `position.level`), while manual entry
// stores the capitalized labels `Federal` / `State` / `County/Regional` /
// `Local/Township/City` (OfficeStepForm). Match case-insensitively on the only
// two levels that change behavior; everything else — county/city/township,
// regional, and any missing value on a pre-structured-office campaign — maps to
// `local`, the safe default for our overwhelmingly down-ballot audience that
// keeps the candidate from stalling on a hidden field.
type OfficeLevel = 'federal' | 'state' | 'local'

export const ballotLevelToOfficeLevel = (
  ballotLevel: string | null | undefined,
): OfficeLevel => {
  const normalized = ballotLevel?.trim().toLowerCase()
  if (normalized === 'federal') return 'federal'
  if (normalized === 'state') return 'state'
  return 'local'
}

// EIN and committee come from `campaign.details` (the EIN was collected and
// validated at the previous step). Email/phone/address are left blank: account
// contact info frequently does not match the official filing, and a PIN is only
// delivered if these match the filing exactly (mirrors ElectionFiling's
// getInitialFormState / ENG-10290).
export const getInitialFilingDetailsState = (
  campaign: ReturnType<typeof useCampaign>[0],
): FormDataState => {
  const details = (campaign?.details ?? {}) as {
    einNumber?: string | null
    campaignCommittee?: string
    ballotLevel?: string | null
  }
  return {
    electionFilingLink: '',
    campaignCommitteeName: details.campaignCommittee || '',
    officeLevel: ballotLevelToOfficeLevel(details.ballotLevel),
    ein: details.einNumber || '',
    phone: '',
    address: { formatted_address: '', place_id: '' },
    website: '',
    email: '',
  }
}

const getStringValue = (value: FormDataState[keyof FormDataState]): string =>
  typeof value === 'string' ? value : ''

// Peerly delivers the verification PIN to an email or phone that matches the
// filing, so both are required. The filing address is required too: the agentic
// flow submits a TCR registration whose postal address is resolved from this
// placeId, so a blank address starts a run that only fails several paid steps
// later at the Peerly submit. (Supersedes 86aj5bqvw, which made the address
// optional before the agentic Peerly postal-address requirement was known.)
const validateFilingDetails = (data: FormDataState) =>
  validateRegistrationForm(data, {
    requireWebsite: false,
    contactSelection: { email: true, phone: true, address: true },
  })

interface FilingDetailsFormProps {
  onSubmit: (formData: FormDataState) => void
  loading: boolean
}

const FilingDetailsForm = ({
  onSubmit,
  loading,
}: FilingDetailsFormProps): React.JSX.Element => {
  const { formData, handleChange } = useFormData()
  const {
    officeLevel,
    campaignCommitteeName,
    electionFilingLink,
    email,
    phone,
  } = formData
  const isFederal = getStringValue(officeLevel) === 'federal'

  const { validations, isValid } = validateRegistrationForm(formData, {
    requireWebsite: false,
    contactSelection: { email: true, phone: true, address: true },
  })

  // `website` is validated but has no input in this form (the agentic flow
  // buys the domain after submit), so the banner must never name it. `ein`
  // has no input here either, but it can't fail: EIN is owned by the wizard's
  // EIN step, and the step redirects a missing/bad persisted EIN there before
  // rendering (ENG-10346).
  const failingFields = getFailingFields(validations).filter(
    (field) => field !== 'website',
  )

  // Always-enabled button so the candidate can attempt submit and get guiding
  // errors; field errors only surface after the first invalid attempt.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const showError = (field: ValidationField): boolean =>
    attemptedSubmit && !validations[field]

  const addressValue = formData.address
  const initialAddress =
    addressValue &&
    typeof addressValue === 'object' &&
    'formatted_address' in addressValue
      ? (addressValue as { formatted_address: string }).formatted_address
      : ''
  const [addressInput, setAddressInput] = useState(initialAddress)

  const [validFecCommitteeId, setValidFecCommitteeId] = useState(
    getFecCommitteeIdValidation(getStringValue(formData.fecCommitteeId)),
  )
  const handleFecCommitteeIdChange = (value: string) => {
    setValidFecCommitteeId(getFecCommitteeIdValidation(value))
    handleChange({ fecCommitteeId: value })
  }

  // Synchronous double-submit guard. `loading` is a parent prop that only
  // reflects the submission after a re-render, so a second click in the same
  // render cycle would slip past `if (loading)` and create a second TCR
  // registration. A ref flips immediately. Mirrors the shared
  // TextingComplianceRegistrationForm.
  const submittingRef = useRef(false)
  useEffect(() => {
    if (!loading) submittingRef.current = false
  }, [loading])

  const { goToPreviousStep } = useProUpgradeWizard()

  const handleContinue = () => {
    if (!isValid) {
      setAttemptedSubmit(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (submittingRef.current || loading) return
    submittingRef.current = true
    // Non-federal committees submit as CANDIDATE and must not carry an FEC id
    // (the backend rejects a stray fecCommitteeId on non-federal). Federal keeps
    // the entered FEC id + committee type as-is. Mirrors the shared
    // TextingComplianceRegistrationForm submit shaping.
    if (isFederal) {
      onSubmit(formData)
      return
    }
    const { fecCommitteeId: _fec, ...rest } = formData
    onSubmit({ ...rest, committeeType: 'CANDIDATE' })
  }

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        What are your campaign filing details?
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        If these do not match the details you submitted on your campaign filing
        or registration, it will take much longer before you can send text
        messages.
      </Body2>

      {attemptedSubmit && !isValid && (
        <StyledAlert severity="error" className="mb-6">
          <Body2 className="w-full min-w-0 break-words">
            <span className="font-medium">
              Please fix the following fields:
            </span>
            <ul className="mt-1 list-disc pl-5">
              {failingFields.map((field) => (
                // `list-item` overrides the global `[data-slot] ul li` rule
                // (globals.css) that forces `display: flex` for sidebar lists.
                // Inside the alert's data-slot that flex splits the bold label
                // and the message into two shrinking columns (ENG-10373).
                <li key={field} className="list-item">
                  <span className="font-medium">
                    {fieldDisplayNames[field]}
                  </span>
                  {' — '}
                  {getValidationMessage(field, getStringValue(officeLevel))}
                </li>
              ))}
            </ul>
          </Body2>
        </StyledAlert>
      )}

      <div className="flex flex-col gap-6">
        <TextField
          label="Campaign committee name"
          placeholder="Jane for Council"
          fullWidth
          required
          error={showError('campaignCommitteeName')}
          value={getStringValue(campaignCommitteeName)}
          onChange={(e) =>
            handleChange({ campaignCommitteeName: e.target.value })
          }
        />
        <TextField
          label="Campaign filing link"
          placeholder="https://"
          fullWidth
          required
          error={showError('electionFilingLink')}
          helperText="Required — a link to your official campaign filing."
          value={getStringValue(electionFilingLink)}
          onChange={(e) => handleChange({ electionFilingLink: e.target.value })}
        />

        {isFederal && (
          <>
            <FecCommitteeIdInput
              value={getStringValue(formData.fecCommitteeId)}
              validated={validFecCommitteeId}
              onChange={handleFecCommitteeIdChange}
              error={showError('fecCommitteeId')}
            />
            <div className="flex w-full flex-col gap-1.5">
              <Label>Committee type *</Label>
              <Select
                value={getStringValue(formData.committeeType)}
                onValueChange={(val) => handleChange({ committeeType: val })}
              >
                <SelectTrigger
                  className="w-full"
                  aria-invalid={showError('committeeType') || undefined}
                >
                  <SelectValue placeholder="Select committee type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOUSE">House</SelectItem>
                  <SelectItem value="SENATE">Senate</SelectItem>
                  <SelectItem value="PRESIDENTIAL">Presidential</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div>
          <div className="font-medium">Filing contact details</div>
          <Body2 className="text-base-muted-foreground mt-1 mb-4">
            Enter the email and phone that appear on your campaign filing — your
            PIN is sent to one of these to verify your campaign. Your filing
            address is required to register for texting.
          </Body2>
          <div className="flex flex-col gap-6">
            <TextField
              label="Email"
              placeholder="jane@gmail.com"
              fullWidth
              required
              error={showError('email')}
              value={getStringValue(email)}
              onChange={(e) => handleChange({ email: e.target.value })}
            />
            <TextField
              label="Phone"
              placeholder="(555) 555-5555"
              fullWidth
              required
              error={showError('phone')}
              value={getStringValue(phone)}
              onChange={(e) => handleChange({ phone: e.target.value })}
            />
            <AddressAutocomplete
              value={addressInput}
              onChange={(value) => {
                setAddressInput(value)
                if (!value) handleChange({ address: null })
              }}
              onSelect={(place) => {
                setAddressInput(place.formatted_address || '')
                handleChange({
                  address: {
                    formatted_address: place.formatted_address || '',
                    place_id: place.place_id || '',
                  },
                })
              }}
              placeholder="Address"
              variant="outlined"
              dropdownClassName="texting-compliance-address-dropdown"
            />
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={goToPreviousStep}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto"
          onClick={handleContinue}
          loading={loading}
          disabled={loading}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

// Pre-payment wizard filing-details step (task 11). Collects the TCR
// registration data and submits it via the same createAgentic call the
// election-filing form uses, so the two flows can't drift. The submit no longer
// dispatches the compliance agent for a non-Pro candidate — that moved to the
// payment-success webhook (task 02, ENG-10323) — so there is nothing to gate
// client-side; using createAgentic is enough.
const FilingDetailsStep = (): React.JSX.Element => {
  const { goToNextStep } = useProUpgradeWizard()
  const router = useRouter()
  const [campaign] = useCampaign()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)

  const ready = Boolean(campaign)

  // This form has no EIN input, so an EIN validation failure here is one the
  // candidate cannot fix in place (ENG-10346). Entry derivation already keeps
  // the normal flow out, but a direct-URL arrival (stale tab, bookmark) with a
  // missing or sanity-failing persisted EIN must go to the EIN step, which
  // owns the field — never see an error about a field this page doesn't have.
  const mustFixEin =
    ready && !checkEinSanity(campaign?.details?.einNumber ?? '').valid

  useEffect(() => {
    if (mustFixEin) router.replace(proUpgradeStepPath(PRO_UPGRADE_STEP.EIN))
  }, [mustFixEin, router])

  // Fire the funnel view event once the form is actually shown (gated behind
  // `ready`), not while the Loading… placeholder is up or while redirecting
  // away to the EIN step.
  const viewTrackedRef = useRef(false)
  useEffect(() => {
    if (!ready || mustFixEin || viewTrackedRef.current) return
    viewTrackedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingDetailsViewed)
  }, [ready, mustFixEin])

  const handleSubmit = async (formData: FormDataState) => {
    if (loading) return
    setLoading(true)
    try {
      await submitTcrCompliance(
        apiRoutes.campaign.tcrCompliance.createAgentic,
        toRegistrationFormData(formData),
        'Failed to submit filing details',
      )
      trackEvent(EVENTS.Outreach.DlcCompliance.RegistrationSubmitted, {
        email: getStringValue(formData.email),
        dlcComplianceStatus: 'Pending',
      })
      // The TCR record now drives filingComplete in ProUpgradeEntry's step
      // derivation; invalidate so a returning candidate resumes past this step.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: TCR_COMPLIANCE_QUERY_KEY }),
      ])
      goToNextStep()
    } catch {
      trackEvent(EVENTS.Outreach.DlcCompliance.RegistrationSubmitError, {
        email: getStringValue(formData.email),
      })
      errorSnackbar('Failed to submit filing details. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  if (!ready || mustFixEin) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <FormDataProvider
      initialState={getInitialFilingDetailsState(campaign)}
      validator={validateFilingDetails}
    >
      <FilingDetailsForm onSubmit={handleSubmit} loading={loading} />
    </FormDataProvider>
  )
}

export default FilingDetailsStep
