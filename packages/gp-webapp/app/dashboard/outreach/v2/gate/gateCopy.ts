// Shared copy for the Pro-and-verification "gate" that blocks an outreach
// channel until the candidate upgrades (and, for texting, also verifies their
// campaign). Verbatim from the 2026-09-21 design export; do not rewrite the
// strings. The gate screens, the explainer modal and the wizard's
// interstitial all read from here, so a channel reads the same words wherever
// it is stopped.
export type GateChannel = 'sms' | 'robocall' | 'door' | 'phone-bank'

export const GATE_NOUN: Record<GateChannel, string> = {
  sms: 'text',
  robocall: 'call',
  door: 'list',
  'phone-bank': 'call list',
}

export const PRO_COPY: Record<
  GateChannel,
  { headline: string; bullets: [string, string, string] }
> = {
  sms: {
    headline: 'Unlock SMS and target mobile phone numbers',
    bullets: [
      '$10 per month, cancel anytime',
      'Your message, delivered to every voter you picked',
      'Scheduled for the day and time you choose',
    ],
  },
  robocall: {
    headline: 'Unlock robocalls and target voters with landlines',
    bullets: [
      '$10 per month, cancel anytime',
      'Your recording, delivered to every voter you picked',
      'Scheduled for the day and time you choose',
    ],
  },
  door: {
    headline: 'Unlock door knocking and meet voters at home',
    bullets: [
      '$10 per month, cancel anytime',
      'Addresses, routes and voter details, mapped for you',
      'Turf you can split across your volunteers',
    ],
  },
  'phone-bank': {
    headline: 'Unlock phone banking and talk to voters one by one',
    bullets: [
      '$10 per month, cancel anytime',
      'Voter phone numbers, and a call list to work through',
      'A script for every call, and a place to log the answer',
    ],
  },
}

// The collapsible verification card inside ProPitchPanel (design:
// proPitchPanel). Texting is the only channel the carriers gate, so this is
// the only channel that shows it.
export const PITCH_PANEL_COPY = {
  verifyTitle: 'Campaign verification included',
  verifyBody:
    'Phone carriers verify every candidate before sending their messages.',
  verifyRows: [
    'We register your campaign',
    'You receive a PIN to verify your identity',
    'Start sending SMS campaigns once approved',
  ],
  verifyFeePill: 'We cover the $120 registration fee',
}

export const INTERSTITIAL_COPY = {
  title: 'Join Pro to send this campaign',
  cta: 'Join Pro',
  dismiss: 'Maybe later',
}

// Post-upgrade resume copy (design: sgNextNoun / sgNextLine / proResumeCta).
export const RESUME_COPY: Record<
  GateChannel,
  { nextNoun: string; nextLine: string; cta: string }
> = {
  sms: {
    nextNoun: 'schedule your text',
    nextLine: 'Pick a date and time, then review and send.',
    cta: 'Schedule text',
  },
  robocall: {
    nextNoun: 'schedule your robocall',
    nextLine: 'Pick a date and time, review the cost, and pay for the calls.',
    cta: 'Schedule robocall',
  },
  door: {
    nextNoun: 'build your walk list',
    nextLine: 'Build the route, then save your walk list and start knocking.',
    cta: 'Continue',
  },
  'phone-bank': {
    nextNoun: 'download your call list',
    nextLine: 'Download your call list, then start calling.',
    cta: 'Continue',
  },
}

// The gated review step's primary button, by what still stands in the way
// (design: the sms review CTA reads "Save draft" before Pro and "Start
// verification" once Pro but not yet cleared). The keys are spelled out
// rather than imported from useOutreachGate's GateRequirement so this file
// keeps no dependency on the hook; indexing it with a requirement is what
// catches drift.
export const REVIEW_GATE_CTA: Record<
  'pro' | 'verify' | 'in_review' | 'pin',
  string
> = {
  pro: 'Save draft',
  verify: 'Start verification',
  in_review: 'Save draft',
  pin: 'Enter your PIN',
}

export const BANNER_COPY = {
  twoStepFree: (noun: string): string =>
    `Two things are needed before this ${noun} can send.`,
  needsVerification: (noun: string): string =>
    `Campaign verification is needed before this ${noun} can send.`,
  inReview: 'Campaign verification is with the carriers, usually 1 to 2 weeks.',
  awaitingPin:
    'You will be sent a PIN within 7 business days to either your email, phone or address.',
  door: 'Pro is needed to see voter names and addresses on this route.',
  phoneBank: 'Pro is needed to see voter names and phone numbers on this list.',
  robocall: 'Pro is needed before this call can go out.',
}

export const EXPLAINER_COPY = {
  // The two list channels name what Pro unlocks (design update 2026-09-24:
  // the "phone banking ad" and "door knocking ad" cards); the sending
  // channels keep the export's title.
  titleFree: (channel: GateChannel): string =>
    channel === 'door'
      ? 'Join Pro to start knocking'
      : channel === 'phone-bank'
        ? 'Join Pro to call this list'
        : 'Join Pro to send this campaign',
  titleVerify: (noun: string): string =>
    `One more step before this ${noun} can send`,
  titleInReview: 'Your campaign verification is in review',
  bodyVerify: (noun: string): string =>
    `Your ${noun} stays saved while we register your campaign with the carriers.`,
  bodyInReview:
    'Phone carriers are reviewing your campaign, usually 1 to 2 weeks. We will tell you when it clears.',
  ctaJoin: 'Join Pro',
  ctaVerify: 'Start verification',
  ctaPin: 'Enter your PIN',
  dismissPro: 'Later',
}

// The gate's full-screen in-review / awaiting-PIN notice cards (task 8): no
// dedicated design-canvas function covers these, so this is new copy
// following the same pattern as the rest of this file. `backToNoun` is also
// campaign verification's `completeLabel` when it is mounted inside the
// gate, so the candidate lands back on the same word regardless of which
// gate screen sent them there.
// The header overline the flow sheet shows in place of the channel badge
// while a gate screen is up (design: renderSgModal's phase label).
export const GATE_CHROME_COPY = {
  upgrade: 'Upgrade to Pro',
  verification: 'Campaign verification',
}

export const GATE_NOTICE_COPY = {
  inReviewSavedLine: (noun: string): string =>
    `Your ${noun} stays saved. We tell you when it clears.`,
  backToNoun: (noun: string): string => `Back to my ${noun}`,
}
