import {
  ClockIcon,
  FileTextIcon,
  MailIcon,
} from '@styleguide/components/ui/icons'

// Design copy campaign verification shares with the Pro wizard, which asks for
// the same filing details before payment. One module, so the two surfaces
// cannot drift apart.

// The filing form's section headings. The legacy standalone election-filing
// page omits them and keeps its heading-less look.
export const FILING_DETAILS_TITLE = 'What are your campaign filing details?'
export const FILING_DETAILS_CAPTION =
  'If these do not match the details you submitted on your campaign filing or registration, it will take much longer before you can send text messages.'
export const FILING_CONTACT_TITLE =
  'What is your campaign filing contact information?'
export const FILING_CONTACT_CAPTION =
  'Enter the email, phone, or address exactly as it appears on your filing document. A PIN will be sent to one of these to verify your campaign.'

export const SUBMITTED_TITLE = 'Submitted for verification'
export const SUBMITTED_BODY =
  'Your campaign has been submitted for verification.'

export const PIN_NOTICE_TITLE = 'A PIN is on its way'
export const PIN_NOTICE_BODY =
  'After your campaign is verified, a PIN will be sent to the email, phone, or address that matches your election filing, usually 1 to 2 weeks. Entering the PIN unlocks texting.'

// The rows of what verification needs, as the verification intro lists them.
// The Pro wizard's overview interleaves them with its own EIN and payment rows.
export const FILING_DETAILS_ROW = {
  icon: FileTextIcon,
  title: 'Your filing details',
  body: 'The committee name and filing link or document from your election authority',
}
export const CONTACT_DETAILS_ROW = {
  icon: MailIcon,
  title: 'Contact details',
  body: 'The email, phone or address exactly as it appears on your filing',
}
export const PIN_TIMING_ROW = {
  icon: ClockIcon,
  title: 'About 1 to 2 weeks',
  body: 'A PIN arrives once the carriers clear your campaign',
}

export const VERIFICATION_INTRO_ROWS = [
  FILING_DETAILS_ROW,
  CONTACT_DETAILS_ROW,
  PIN_TIMING_ROW,
]
