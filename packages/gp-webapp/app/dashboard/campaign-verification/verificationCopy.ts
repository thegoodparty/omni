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

// The SMS compliance cutoff. gp-api decides the window; these strings only
// render it. Dates arrive as ISO days and go through formatSmsCutoffDate.
// Never call it a legal or carrier deadline, and never promise refunds.
export const formatSmsCutoffDate = (isoDate: string): string =>
  new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

export const SMS_CUTOFF_COPY = {
  title: "Texting isn't available for this race",
  body: (generalElectionDate: string | null): string =>
    generalElectionDate
      ? `Texting needs campaign verification, which can't finish before your general election on ${generalElectionDate}.`
      : "Texting needs campaign verification, which can't finish before your general election.",
  short: "Texting isn't available for this race.",
  channelsQuestion: 'How else do you want to reach voters?',
  channels: {
    doorKnocking: 'Door knocking',
    robocalls: 'Robocalls',
    phoneBanking: 'Phone banking',
    socialMedia: 'Social media',
  },
  support: 'Questions? Email support@goodparty.org.',
  seeOtherWays: 'See other ways to reach voters',
  closedLabel: 'Texting closed',
  backToOutreach: 'Back to outreach',
  backToDashboard: 'Back to dashboard',
  complianceCardClosingBody: (generalElectionDate: string | null): string =>
    generalElectionDate
      ? `Register your campaign so you can text voters before your ${generalElectionDate} election.`
      : 'Register your campaign so you can text voters before your election.',
  countdown: (cutoff: string): string =>
    `Start texting verification by ${cutoff}.`,
  countdownTitle: (cutoff: string): string =>
    `Start texting verification by ${cutoff}`,
  countdownChip: (cutoff: string): string => `Verify by ${cutoff}`,
  guidanceClosing: (cutoff: string): string =>
    `Finish these by ${cutoff} to text before your election.`,
  guidanceClosedTitle: "Here's what you need to unlock Pro",
  guidanceClosedBody:
    'Pro unlocks voter data, door knocking, robocalls and phone banking.',
  paymentVerificationStarts:
    'Verification starts when you pay. Texting usually opens 1 to 2 weeks later.',
  paymentClosing: (cutoff: string): string =>
    `Finish your upgrade by ${cutoff} to text before your election.`,
  successClosedBody:
    'Payment successful. Your next step is to pick a way to reach voters.',
  successClosedCta: 'Go to outreach',
}

// The filing step for a candidate who saved their details but has not paid.
// Verification only starts at payment, so SUBMITTED_* above stays for the
// post-payment success step.
export const DETAILS_SAVED_TITLE = 'Your details are saved'
export const DETAILS_SAVED_BODY =
  'Verification starts when you finish your upgrade.'
