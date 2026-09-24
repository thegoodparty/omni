'use client'
import { noop } from '@shared/utils/noop'
import TextField from '@shared/inputs/TextField'
import { FilingLinkInfoIcon } from 'app/dashboard/profile/texting-compliance/register/components/FilingLinkInfoIcon'
import {
  FecCommitteeIdInput,
  isValidFecCommitteeId,
  getFecCommitteeIdValidation,
} from 'app/dashboard/profile/texting-compliance/register/components/FecCommitteeIdInput'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from '@styleguide'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import isEmpty from 'validator/es/lib/isEmpty'
import { useFormData } from '@shared/hooks/useFormData'
import TextingComplianceForm from 'app/dashboard/profile/texting-compliance/shared/TextingComplianceForm'
import { EinCheckInput } from 'app/dashboard/shared/EinCheckInput'
import {
  checkEinSanity,
  einIndicatorState,
} from '@shared/inputs/EinSanityCheck'
import isURL from 'validator/es/lib/isURL'
import isMobilePhone from 'validator/es/lib/isMobilePhone'
import isEmail from 'validator/es/lib/isEmail'
import isFilled from '@shared/inputs/IsFilled'
import AddressAutocomplete from '@shared/AddressAutocomplete'
import TextingComplianceFooter from 'app/dashboard/profile/texting-compliance/shared/TextingComplianceFooter'
import { Button } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'

import { urlIncludesPath } from 'helpers/urlIncludesPath'
import { flatStates, isStateAbbreviation } from 'helpers/statesHelper'
import { extractPostalAddress } from 'app/dashboard/profile/texting-compliance/util/mapFormData.util'
import Body2 from '@shared/typography/Body2'
import { StyledAlert } from '@shared/alerts/StyledAlert'
import type { FormDataState } from '@shared/hooks/useFormData'

export type ValidationField =
  | 'electionFilingLink'
  | 'campaignCommitteeName'
  | 'candidateName'
  | 'officeLevel'
  | 'ein'
  | 'phone'
  | 'address'
  | 'website'
  | 'email'
  | 'fecCommitteeId'
  | 'committeeType'
  | 'contactChannel'

// Which of the filing-contact channels the candidate has marked as appearing on
// their official filing. Only selected channels are collected and validated; at
// least one must be selected (ENG-10357). The selected set also tells the
// backend which channels Peerly may send the CV PIN to.
export interface ContactChannelSelection {
  email: boolean
  phone: boolean
  address: boolean
}

// 'verification' is the design's filingdetails screen, rendered by the
// campaign-verification steps: sentence-case labels with example
// placeholders, the filing-link helper in place of the tooltip, no PIN
// warning (the intro covers it), and a Back / "Submit for verification"
// footer in the host's footer bar (StepFooter) that enables once
// every field has a value (the click then validates and lists what is wrong,
// so a landline or a filing link without a path gets an explanation instead
// of a button that never enables). The legacy register and election-filing
// pages keep the default look.
export type FormVariant = 'default' | 'verification'

type ValidationMessages = Record<ValidationField, string>

export const fieldDisplayNames: ValidationMessages = {
  electionFilingLink: 'Election Filing Link',
  campaignCommitteeName: 'Campaign Committee Name',
  candidateName: 'Candidate Name',
  officeLevel: 'Office Level',
  ein: 'EIN',
  phone: 'Filing Phone',
  address: 'Filing Address',
  website: 'Website',
  email: 'Filing Email',
  fecCommitteeId: 'FEC Committee ID',
  committeeType: 'Committee Type',
  contactChannel: 'Filing Contact',
}

export const getValidationMessage = (
  field: ValidationField,
  officeLevel?: string,
): string => {
  const messages: ValidationMessages = {
    electionFilingLink:
      officeLevel === 'federal'
        ? 'Must be from FEC.gov (e.g., https://fec.gov/data/committee/C00123456)'
        : 'Enter a valid URL with a path (e.g., https://example.com/candidates)',
    campaignCommitteeName:
      'Your official committee name (e.g., "Smith for Council")',
    candidateName:
      "The candidate's own name, as it appears on the election filing",
    officeLevel: 'Select an option',
    ein: "Enter your campaign's real EIN (XX-XXXXXXX) — placeholder values aren't accepted",
    phone: 'Valid US phone number as it appears on your election filing',
    address:
      'Street (or PO Box), city, state, and ZIP are required — pick a suggestion or fill them in',
    website: 'Valid URL',
    email: 'Valid email address as it appears on your election filing',
    fecCommitteeId: 'Must be "C" followed by 8 digits (e.g., C00123456)',
    committeeType: 'Select House, Senate, or Presidential',
    contactChannel:
      'Select at least one of email, phone, or address from your filing',
  }
  return messages[field]
}

type AddressValue = Parameters<
  NonNullable<ComponentProps<typeof AddressAutocomplete>['onSelect']>
>[0]

type FormValue = FormDataState[keyof FormDataState] | undefined

const isAddressValue = (value: FormValue): value is AddressValue =>
  Boolean(value && typeof value === 'object' && 'formatted_address' in value)

const getStringValue = (value: FormValue): string =>
  typeof value === 'string' ? value : ''

const validateAddress = (address: AddressValue | null): boolean =>
  Boolean(address?.formatted_address)

export interface ManualAddressValue {
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  zip: string
}

export const EMPTY_MANUAL_ADDRESS: ManualAddressValue = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
}

export const isManualAddressValue = (
  value: FormValue,
): value is ManualAddressValue =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'addressLine1' in value &&
    'city' in value &&
    'state' in value &&
    'zip' in value,
  )

export const validateManualAddress = (
  manualAddress: ManualAddressValue | null,
): boolean =>
  Boolean(
    manualAddress &&
    isFilled(manualAddress.addressLine1) &&
    isFilled(manualAddress.city) &&
    isStateAbbreviation(manualAddress.state.trim().toUpperCase()) &&
    /^\d{5}(-\d{4})?$/.test(manualAddress.zip.trim()),
  )

// Shared filing-address fields, used by both the standalone register form
// and the pro-upgrade wizard's filing-details step (anti-drift rule: one
// source for the fields and their validation). The street input carries
// Google Places autocomplete as a helper, never a gate: picking a suggestion
// auto-fills city/state/ZIP and keeps the resolved place authoritative, while
// anything typed by hand (PO Boxes, rural addresses Google can't suggest)
// submits as structured components.
export const FilingAddressFields = ({
  address,
  manualAddress,
  onChange,
  showError,
  variant = 'default',
}: {
  address: AddressValue | null
  manualAddress: ManualAddressValue
  onChange: (patch: {
    address: AddressValue | null
    manualAddress: ManualAddressValue
  }) => void
  showError: boolean
  variant?: FormVariant
}): React.JSX.Element => {
  const design = variant === 'verification'
  // Any hand edit drops the selected place: a placeId submission is resolved
  // from Google server-side, so an edited component (even the unit line)
  // would otherwise be silently ignored. Without a place, the structured
  // fields are what get submitted — and validated.
  const edit = (patch: Partial<ManualAddressValue>) =>
    onChange({ address: null, manualAddress: { ...manualAddress, ...patch } })

  const fieldErrors = showError && !validateAddress(address)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-full flex-col gap-1.5">
        <Label>
          {design ? 'Street address or PO Box' : 'Street address or PO Box *'}
        </Label>
        <AddressAutocomplete
          value={manualAddress.addressLine1}
          onChange={(value) => edit({ addressLine1: value })}
          onSelect={(place) => {
            const components = extractPostalAddress(place)
            onChange({
              address: {
                formatted_address: place.formatted_address || '',
                place_id: place.place_id || '',
              },
              manualAddress: {
                addressLine1:
                  components.streetLines[0] || place.formatted_address || '',
                addressLine2: manualAddress.addressLine2,
                city: components.city,
                state: components.state,
                zip: components.postalCode,
              },
            })
          }}
          placeholder={
            design
              ? '123 Main St'
              : 'Start typing to search, or enter it yourself'
          }
          variant="outlined"
          error={fieldErrors && !isFilled(manualAddress.addressLine1)}
          dropdownClassName="texting-compliance-address-dropdown"
        />
      </div>
      <TextField
        label="Apt, suite, unit (optional)"
        placeholder={design ? 'Suite 200' : undefined}
        fullWidth
        value={manualAddress.addressLine2 || ''}
        onChange={(e) => edit({ addressLine2: e.target.value })}
      />
      <div className="flex flex-col gap-4 sm:flex-row">
        <TextField
          label="City"
          placeholder={design ? 'Seattle' : undefined}
          fullWidth
          required={!design}
          error={fieldErrors && !isFilled(manualAddress.city)}
          value={manualAddress.city}
          onChange={(e) => edit({ city: e.target.value })}
        />
        <div className="flex w-full flex-col gap-1.5 sm:max-w-28">
          <Label>{design ? 'State' : 'State *'}</Label>
          <Select
            value={manualAddress.state}
            onValueChange={(state) => edit({ state })}
          >
            <SelectTrigger
              className="w-full"
              aria-invalid={
                (fieldErrors && !isStateAbbreviation(manualAddress.state)) ||
                undefined
              }
            >
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              {flatStates.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TextField
          label="ZIP"
          placeholder={design ? '98103' : '12345'}
          fullWidth
          required={!design}
          className="sm:max-w-36"
          error={
            fieldErrors && !/^\d{5}(-\d{4})?$/.test(manualAddress.zip.trim())
          }
          value={manualAddress.zip}
          onChange={(e) => edit({ zip: e.target.value })}
        />
      </div>
    </div>
  )
}

const validateFECUrl = (url: string): boolean => {
  if (!url) return false
  // Must be from fec.gov AND include a path (not just the domain)
  return /fec\.gov/i.test(url) && urlIncludesPath(url)
}

type ValidationResult = {
  validations: Record<ValidationField, boolean>
  isValid: boolean
}

export const getFailingFields = (
  validations: Record<ValidationField, boolean>,
): ValidationField[] => {
  const fields: ValidationField[] = []
  let key: ValidationField
  for (key in validations) {
    if (!validations[key]) {
      fields.push(key)
    }
  }
  return fields
}

interface ValidateOpts {
  // When false, allows blank `website` (new agentic flow purchases the domain
  // after this form submits, before sending to peerly).
  requireWebsite?: boolean
  // When provided, email/phone/address are each only required if their channel
  // is selected, and at least one channel must be selected (ENG-10357). When
  // omitted (legacy register + profile election-filing flows), all three remain
  // individually required, exactly as before.
  contactSelection?: ContactChannelSelection
}

export const validateRegistrationForm = (
  data: FormDataState,
  opts: ValidateOpts = {},
): ValidationResult => {
  const { requireWebsite = true, contactSelection } = opts
  const {
    electionFilingLink,
    campaignCommitteeName,
    candidateName,
    officeLevel,
    ein,
    phone,
    address,
    manualAddress,
    website,
    email,
    fecCommitteeId,
    committeeType,
  } = data

  const electionFilingLinkValue = getStringValue(electionFilingLink)
  const campaignCommitteeNameValue = getStringValue(campaignCommitteeName)
  const candidateNameValue = getStringValue(candidateName)
  const officeLevelValue = getStringValue(officeLevel)
  const einValue = getStringValue(ein)
  const phoneValue = getStringValue(phone)
  const addressValue = isAddressValue(address) ? address : null
  const manualAddressValue = isManualAddressValue(manualAddress)
    ? manualAddress
    : null
  const websiteValue = getStringValue(website)
  const emailValue = getStringValue(email)
  const fecCommitteeIdValue = getStringValue(fecCommitteeId)
  const committeeTypeValue = getStringValue(committeeType)

  // When `contactSelection` is supplied, an unselected channel has no visible
  // input, so it must validate as `true` (not required); a selected channel
  // validates its format as normal. With no selection (legacy flows), all three
  // stay individually required.
  const emailRequired = contactSelection ? contactSelection.email : true
  const phoneRequired = contactSelection ? contactSelection.phone : true
  const addressRequired = contactSelection ? contactSelection.address : true

  const baseValidations: Record<ValidationField, boolean> = {
    electionFilingLink:
      isURL(electionFilingLinkValue) &&
      urlIncludesPath(electionFilingLinkValue),
    campaignCommitteeName: isFilled(campaignCommitteeNameValue),
    candidateName: isFilled(candidateNameValue.trim()),
    officeLevel: ['federal', 'state', 'local'].includes(officeLevelValue),
    ein: checkEinSanity(einValue).valid,
    phone: phoneRequired ? isMobilePhone(phoneValue, 'en-US') : true,
    // TODO: We should do idiomatic "recommended address" validation flow here,
    //  and elsewhere, to have higher degree of confidence that the address
    //  entered is valid
    // An intact autocomplete selection is authoritative (the form clears it
    // on any hand edit); otherwise the structured components must be
    // complete, since they are what will be submitted.
    address: addressRequired
      ? validateAddress(addressValue) ||
        validateManualAddress(manualAddressValue)
      : true,
    website: requireWebsite
      ? isFilled(websiteValue) && isURL(websiteValue)
      : !isFilled(websiteValue) || isURL(websiteValue),
    email: emailRequired ? isEmail(emailValue) : true,
    fecCommitteeId: true, // Not required for non-federal
    committeeType: true, // Not required for non-federal
    // Only meaningful when `contactSelection` is in play: at least one of the
    // three filing-contact channels must be selected. Always `true` for the
    // legacy flows, which require all three by other means.
    contactChannel: contactSelection
      ? contactSelection.email ||
        contactSelection.phone ||
        contactSelection.address
      : true,
  }

  // Add federal-specific validations
  if (officeLevelValue === 'federal') {
    const validCommitteeTypes = ['HOUSE', 'SENATE', 'PRESIDENTIAL']
    const federalValidations = {
      ...baseValidations,
      electionFilingLink: validateFECUrl(electionFilingLinkValue),
      fecCommitteeId: isValidFecCommitteeId(fecCommitteeIdValue),
      committeeType: validCommitteeTypes.includes(committeeTypeValue),
    }

    return {
      validations: federalValidations,
      isValid: Object.values(federalValidations).every(Boolean),
    }
  }

  return {
    validations: baseValidations,
    isValid: Object.values(baseValidations).every(Boolean),
  }
}

// An extra error line for the validation alert, contributed by a composing
// surface (election-filing's inline candidate profile). Rendered in the same
// list as the form's own failing fields so every blocker appears in one
// alert at the top of the page.
export interface ExtraValidationError {
  label: string
  message: string
}

interface TextingComplianceRegistrationFormProps {
  onSubmit?: (formData: FormDataState) => void
  loading?: boolean
  hasSubmissionError?: boolean
  requireWebsite?: boolean
  // Rendered between the validation alert and the form fields. Lets a
  // composing surface (election-filing's candidate-profile section) sit
  // above the filing fields while the alert stays at the very top of the
  // page.
  topSection?: React.ReactNode
  // Called on every submit attempt, before the validity gate, so the
  // composing surface can flag its own fields even when the filing fields
  // are also invalid. Returning false blocks submission exactly like a
  // failing filing field.
  onValidateExtra?: () => boolean
  extraErrors?: ExtraValidationError[]
  // Section headings the embeddable campaign-verification steps pass in
  // (design: "What are your campaign filing details?" /
  // "What is your campaign filing contact information?"). Omitted by the
  // legacy standalone election-filing page, which keeps its current
  // (heading-less) look.
  title?: string
  caption?: string
  contactTitle?: string
  contactCaption?: string
  variant?: FormVariant
  // The 'verification' variant's inline footer Back.
  onBack?: () => void
}

const TextingComplianceRegistrationForm = ({
  onSubmit = noop,
  loading = false,
  hasSubmissionError = false,
  requireWebsite = true,
  topSection,
  onValidateExtra,
  extraErrors = [],
  title,
  caption,
  contactTitle,
  contactCaption,
  variant = 'default',
  onBack,
}: TextingComplianceRegistrationFormProps): React.JSX.Element => {
  const design = variant === 'verification'
  const { formData, handleChange } = useFormData()
  const {
    electionFilingLink,
    campaignCommitteeName,
    candidateName,
    officeLevel,
    ein,
    phone,
    address,
    email,
  } = formData
  const formValidation = validateRegistrationForm(formData, { requireWebsite })
  const { isValid, validations } = formValidation
  // `website` is validated but has no input in this form — it is derived from
  // the campaign's purchased domain upstream (the register page redirects to
  // domain purchase when absent, and the election-filing flow passes
  // requireWebsite=false). Exclude it so the error banner never tells the user
  // to fix a field they cannot see or interact with.
  const failingFields = getFailingFields(validations).filter(
    (field) => field !== 'website',
  )

  // The Submit button is always enabled so the user can attempt submission and
  // receive guiding errors. Errors (banner + red field borders) only surface
  // once they've actually tried to submit an invalid form.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const showError = (field: ValidationField): boolean =>
    attemptedSubmit && !validations[field]

  // Synchronous double-submit guard. `loading` is a parent prop that only
  // reflects the submission after a re-render, so it can't block a second click
  // fired within the same render cycle. A ref flips immediately.
  const submittingRef = useRef(false)
  useEffect(() => {
    if (!loading) submittingRef.current = false
  }, [loading])

  const addressValue = isAddressValue(address) ? address : null
  // A pre-existing selection (resumed form) has no stored components, so the
  // street field falls back to displaying its formatted address; the intact
  // place keeps validation and submission on the placeId path until edited.
  const manualAddress = isManualAddressValue(formData.manualAddress)
    ? formData.manualAddress
    : {
        ...EMPTY_MANUAL_ADDRESS,
        addressLine1: addressValue?.formatted_address || '',
      }

  // TODO: Move this redundant logic into EinCheckInput and refactor consumer
  //  components to support signature change
  const [validEin, setValidEin] = useState(
    einIndicatorState(getStringValue(ein)),
  )
  // The verification steps run after the purchase-only wizard, which has
  // already collected the EIN, so a valid prefill is not asked for again
  // (design: filingdetails has no EIN field). Captured once so a later edit
  // elsewhere cannot make the field pop in mid-form.
  const [einPrefilled] = useState(
    () => design && checkEinSanity(getStringValue(ein)).valid,
  )
  // Presence, not validity: the verification footer enables as soon as every
  // required field has something in it, and the click runs the real
  // validation (banner + red borders) so the candidate learns which value is
  // off. A button held on validity alone gave no such explanation.
  const isFederal = getStringValue(officeLevel) === 'federal'
  const requiredFilled =
    !isEmpty(getStringValue(officeLevel)) &&
    !isEmpty(getStringValue(candidateName).trim()) &&
    !isEmpty(getStringValue(campaignCommitteeName).trim()) &&
    !isEmpty(getStringValue(electionFilingLink).trim()) &&
    !isEmpty(getStringValue(email).trim()) &&
    !isEmpty(getStringValue(phone).trim()) &&
    (einPrefilled || !isEmpty(getStringValue(ein).trim())) &&
    (validateAddress(addressValue) ||
      (!isEmpty(manualAddress.addressLine1.trim()) &&
        !isEmpty(manualAddress.city.trim()) &&
        !isEmpty(manualAddress.state.trim()) &&
        !isEmpty(manualAddress.zip.trim()))) &&
    (!isFederal ||
      (!isEmpty(getStringValue(formData.fecCommitteeId).trim()) &&
        !isEmpty(getStringValue(formData.committeeType))))

  // The verification variant scrolls inside its host (the full-screen chrome
  // or the outreach sheet), where window.scrollTo reaches nothing, so the
  // error banner is brought into view through a marker at the top of the
  // form instead.
  const formTopRef = useRef<HTMLDivElement>(null)
  const handleEINChange = (value: string) => {
    setValidEin(einIndicatorState(value))
    handleChange({ ein: value })
  }

  const [validFecCommitteeId, setValidFecCommitteeId] = useState(
    getFecCommitteeIdValidation(getStringValue(formData.fecCommitteeId)),
  )
  const handleFecCommitteeIdChange = (value: string) => {
    setValidFecCommitteeId(getFecCommitteeIdValidation(value))
    handleChange({ fecCommitteeId: value })
  }

  const handleOnSubmit = () => {
    // Validate the composed section on every attempt (not just when the
    // filing fields pass) so its errors surface alongside the field errors —
    // otherwise a user with an empty bio and an invalid filing field would
    // never learn the bio is required until the filing fields were fixed.
    const extraValid = onValidateExtra ? onValidateExtra() : true
    // Always-enabled button: block submission of an invalid form and reveal the
    // guiding errors instead. The footer is fixed at the bottom of a long form,
    // so scroll the error banner (rendered at the top) into view.
    if (!isValid || !extraValid) {
      setAttemptedSubmit(true)
      if (design) {
        formTopRef.current?.scrollIntoView({
          block: 'start',
          behavior: 'smooth',
        })
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      return
    }
    // Block a double-submit. The ref is set synchronously below, so a second
    // rapid click within the same render cycle is caught even before `loading`
    // propagates from the parent.
    if (submittingRef.current || loading) return
    submittingRef.current = true
    // Federal: include fecCommitteeId and committeeType (HOUSE/SENATE/PRESIDENTIAL) as entered
    // Non-federal: exclude fecCommitteeId, set committeeType to 'CANDIDATE'
    const { fecCommitteeId: _, committeeType: __, ...baseFormData } = formData
    const submitData =
      officeLevel === 'federal'
        ? formData
        : { ...baseFormData, committeeType: 'CANDIDATE' }
    return onSubmit(submitData)
  }

  const emailField = (
    <TextField
      label={design ? 'Email' : 'Filing Email'}
      placeholder={design ? 'you@campaign.org' : 'jane@gmail.com'}
      fullWidth
      required={!design}
      error={showError('email')}
      value={getStringValue(email)}
      onChange={(e) => handleChange({ email: e.target.value })}
    />
  )
  const phoneField = (
    <TextField
      label={design ? 'Phone' : 'Filing Phone'}
      placeholder={design ? '(555) 123-4567' : '(555) 555-5555'}
      required={!design}
      fullWidth
      error={showError('phone')}
      value={getStringValue(phone)}
      onChange={(e) => handleChange({ phone: e.target.value })}
    />
  )
  const addressFields = (
    <FilingAddressFields
      address={addressValue}
      manualAddress={manualAddress}
      onChange={(patch) => handleChange(patch)}
      showError={showError('address')}
      variant={variant}
    />
  )

  return (
    <>
      <TextingComplianceForm
        className={design ? 'flex flex-col gap-4' : undefined}
      >
        {design && <div ref={formTopRef} className="-mt-4 h-0" aria-hidden />}
        {hasSubmissionError && (
          <StyledAlert severity="error">
            <Body2>
              Form submission failed. Contact your Political Assistant to
              complete this process or report the issue.
            </Body2>
          </StyledAlert>
        )}
        {attemptedSubmit && (!isValid || extraErrors.length > 0) && (
          <StyledAlert severity="error">
            <Body2 className="w-full min-w-0 break-words">
              <span className="font-medium">
                Please fix the following fields:
              </span>
              <ul className="mt-1 list-disc pl-5">
                {/* Extras first: the section they belong to renders above
                    the filing fields, so the list reads top-to-bottom. */}
                {extraErrors.map(({ label, message }) => (
                  <li key={label} className="list-item">
                    <span className="font-medium">{label}</span>
                    {' — '}
                    {message}
                  </li>
                ))}
                {failingFields.map((field) => (
                  // `list-item` overrides the global `[data-slot] ul li` rule
                  // (globals.css) that forces `display: flex` for sidebar
                  // lists. Inside the alert's data-slot that flex splits the
                  // bold label and the message into two shrinking columns
                  // (ENG-10373).
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
        {topSection}
        {title && (
          <div>
            <h2
              className={
                design ? 'text-xl font-semibold' : 'text-lg font-medium'
              }
            >
              {title}
            </h2>
            {caption && (
              <p
                className={
                  design
                    ? 'mt-2 text-base text-base-muted-foreground'
                    : 'mt-1 text-sm text-muted-foreground'
                }
              >
                {caption}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5 w-full">
          <Label>{design ? 'Office level' : 'Office Level *'}</Label>
          <Select
            value={getStringValue(officeLevel)}
            onValueChange={(val) => handleChange({ officeLevel: val })}
          >
            <SelectTrigger
              className="w-full"
              aria-invalid={showError('officeLevel') || undefined}
            >
              <SelectValue placeholder="Select an office level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="federal">Federal</SelectItem>
              <SelectItem value="state">State</SelectItem>
              <SelectItem value="local">Local</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TextField
          label={design ? 'Candidate name' : 'Candidate Name'}
          placeholder="Jane Smith"
          fullWidth
          required={!design}
          error={showError('candidateName')}
          value={getStringValue(candidateName)}
          onChange={(e) => handleChange({ candidateName: e.target.value })}
        />
        <TextField
          label={design ? 'Campaign committee name' : 'Campaign Committee Name'}
          placeholder="Jane for Council"
          fullWidth
          required={!design}
          error={showError('campaignCommitteeName')}
          value={getStringValue(campaignCommitteeName)}
          onChange={(e) =>
            handleChange({ campaignCommitteeName: e.target.value })
          }
        />
        {!einPrefilled && (
          <EinCheckInput
            {...{
              value: getStringValue(ein),
              onChange: handleEINChange,
              validated: validEin,
              label: design ? 'Campaign EIN' : 'EIN *',
              error: showError('ein'),
            }}
          />
        )}
        {officeLevel === 'federal' && (
          <>
            <FecCommitteeIdInput
              value={getStringValue(formData.fecCommitteeId)}
              validated={validFecCommitteeId}
              onChange={handleFecCommitteeIdChange}
              error={showError('fecCommitteeId')}
            />
            <div className="flex flex-col gap-1.5 w-full">
              <Label>Committee Type *</Label>
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
        {!design && (
          <StyledAlert severity="warning" className="mb-6">
            <Body2>
              A PIN is required to verify your identity. <br />
              It will only be sent if your email, phone, or address matches your
              election filing. Please review your campaign filing link to ensure
              the email, phone number, or address matches exactly before
              submitting.
            </Body2>
          </StyledAlert>
        )}
        <TextField
          label={design ? 'Campaign filing link' : 'Election Filing Link'}
          placeholder={design ? 'https://' : undefined}
          helperText={
            design
              ? "A direct link to your official campaign filing on your election authority's website."
              : undefined
          }
          fullWidth
          required={!design}
          error={showError('electionFilingLink')}
          endAdornments={
            design ? undefined : [<FilingLinkInfoIcon key="filing-info-icon" />]
          }
          value={getStringValue(electionFilingLink)}
          onChange={(e) => handleChange({ electionFilingLink: e.target.value })}
        />
        {contactTitle && (
          <div className={design ? 'mt-4' : undefined}>
            <h2
              className={
                design ? 'text-xl font-semibold' : 'text-lg font-medium'
              }
            >
              {contactTitle}
            </h2>
            {contactCaption && (
              <p
                className={
                  design
                    ? 'mt-2 text-base text-base-muted-foreground'
                    : 'mt-1 text-sm text-muted-foreground'
                }
              >
                {contactCaption}
              </p>
            )}
          </div>
        )}
        {design ? (
          <>
            {emailField}
            {phoneField}
            {addressFields}
          </>
        ) : (
          <>
            {addressFields}
            {emailField}
            {phoneField}
            <div className="h-32"></div>
          </>
        )}
      </TextingComplianceForm>
      {design ? (
        <StepFooter>
          <Button
            type="button"
            variant="ghost"
            size="large"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={onBack}
          >
            Back
          </Button>
          <Button
            type="button"
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            disabled={loading || !requiredFilled}
            loading={loading}
            onClick={handleOnSubmit}
          >
            Submit for verification
          </Button>
        </StepFooter>
      ) : (
        <TextingComplianceFooter>
          <Button
            size="large"
            disabled={loading}
            loading={loading}
            onClick={handleOnSubmit}
          >
            Submit
          </Button>
        </TextingComplianceFooter>
      )}
    </>
  )
}

export default TextingComplianceRegistrationForm
