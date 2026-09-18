// Shared copy for the Pro-and-verification "gate" that blocks an outreach
// channel until the candidate upgrades (and, for texting, also verifies their
// campaign). Verbatim from the milestone 2 design; do not rewrite the strings
// — a later task mounts this copy inside the outreach flows via the
// embeddable ProUpgradeFlow / CampaignVerificationSteps.
export type GateChannel = 'sms' | 'robocall' | 'door' | 'phone-bank'

export const GATE_NOUN: Record<GateChannel, string> = {
  sms: 'text',
  robocall: 'call',
  door: 'list',
  'phone-bank': 'call list',
}

export const GATE_CHANNEL_LABEL: Record<GateChannel, string> = {
  sms: 'text',
  robocall: 'robocall',
  door: 'door knocking list',
  'phone-bank': 'call list',
}

export const PRO_COPY: Record<
  GateChannel,
  {
    headline: string
    subhead: string
    reassure: string
    cta: string
    unlock: string
  }
> = {
  sms: {
    headline: 'Unlock text banking with Pro',
    subhead:
      'Texting real voters takes Pro. Your first campaign of up to 5,000 texts is free. $10 a month, cancel anytime.',
    reassure:
      'Your message is saved exactly as you wrote it. Upgrading is the only step left to send it.',
    cta: 'Upgrade for $10',
    unlock: 'Campaign-scale outreach',
  },
  robocall: {
    headline: 'Unlock robocalls with Pro',
    subhead: 'Calling voters at scale takes Pro. $10 a month, cancel anytime.',
    reassure:
      'Your script and recording are saved. Upgrading is the only step left to send your call.',
    cta: 'Upgrade to send my call',
    unlock: 'Recorded calls delivered to the voters you picked',
  },
  door: {
    headline: 'Unlock door knocking with Pro',
    subhead: 'Building your walk list takes Pro. $10 a month, cancel anytime.',
    reassure:
      'Your plan is saved. Upgrading is the only step left to build your walk list.',
    cta: 'Upgrade to build my walk list',
    unlock: 'Walk lists, routes and door-by-door logging',
  },
  'phone-bank': {
    headline: 'Unlock phone banking with Pro',
    subhead: 'Calling real voters takes Pro. $10 a month, cancel anytime.',
    reassure:
      'Your script is saved. Upgrading is the only step left to start calling.',
    cta: 'Upgrade to start calling',
    unlock: 'Call lists with scripts and call-by-call logging',
  },
}

export const INTERSTITIAL_COPY = {
  title: (channelLabel: string): string =>
    `Your first ${channelLabel} has been made`,
  bodyTexting:
    "To send it, you need to upgrade to Pro and verify your campaign. We'll save it for 90 days.",
  bodyRobocall:
    "To send it, you need to upgrade to Pro. We'll save it for 90 days.",
  bodyOther: 'To send it, you need to upgrade to Pro. Your work stays saved.',
  finishLater: 'Finish later',
  proStep: {
    title: 'Upgrade to Pro',
    body: 'Reach thousands of voters from your kitchen table.',
    rows: (unlock: string): string[] => [
      '$10 a month, cancel anytime',
      'The voter data big campaigns pay for',
      unlock,
      'Results you can act on next time',
    ],
    pill: 'Your first 5,000 texts are free',
  },
  verifyStep: {
    title: 'Campaign verification',
    body: 'Phone carriers check every political sender before letting texts through.',
    rows: [
      'We collect your campaign details',
      'We file the 10DLC registration for you',
      'We wait on the carriers, usually 1 to 2 weeks, and tell you when it clears',
    ],
  },
}

// The explainer's per-channel "why Pro" block (design: PRO_CHANNEL_WHY).
export const PRO_CHANNEL_WHY: Record<GateChannel, string> = {
  sms: 'Pro covers the voter phone numbers, the drafts written for you, and the delivery, so a text you write can reach thousands of real voters.',
  robocall:
    'Pro covers the voter phone numbers, the recording, and the delivery, so one recording reaches every voter on your list.',
  door: 'Pro covers the addresses, the walking route, and door-by-door logging, so you and your volunteers always know where to knock next.',
  'phone-bank':
    'Pro covers the voter phone numbers, the call script, and call-by-call logging, so every conversation is captured.',
}

export const GATE_CHANNEL_TITLE: Record<GateChannel, string> = {
  sms: 'Text banking with Pro',
  robocall: 'Robocalls with Pro',
  door: 'Door knocking with Pro',
  'phone-bank': 'Phone banking with Pro',
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
  titleOneStep: (noun: string): string =>
    `Pro is needed before this ${noun} can send`,
  titleTwoStep: (noun: string): string =>
    `Two things are needed before this ${noun} can send`,
  titleVerifyOnly: (noun: string): string =>
    `One more step before this ${noun} can send`,
  bodyOneStep:
    'You can keep building now. Upgrading is the only step left before it goes out.',
  bodyTwoStep: (noun: string): string =>
    `You can keep building now. Both steps happen before the first ${noun} goes out.`,
  bodyVerifyOnly: (noun: string): string =>
    `Your ${noun} stays saved while we register your campaign with the carriers.`,
  proRows: (unlock: string): string[] => [
    '$10 a month, cancel anytime',
    'The voter data big campaigns pay for',
    unlock,
    'Results you can act on next time',
  ],
  proBody: 'Reach thousands of voters from your kitchen table.',
  verifyRows: [
    'We collect your campaign details',
    'We file the 10DLC registration for you',
    'We wait on the carriers, usually 1 to 2 weeks, and tell you when it clears',
  ],
  verifyBody:
    'Phone carriers check every political sender before letting texts through.',
  ctaUpgrade: 'Upgrade to Pro',
  ctaVerify: 'Start verification',
  ctaPin: 'Enter your PIN',
  dismissFree: 'Continue without Pro',
  dismissPro: 'Later',
}

// The gate's full-screen in-review / awaiting-PIN notice cards (task 8): no
// dedicated design-canvas function covers these, so this is new copy
// following the same pattern as the rest of this file. `backToNoun` is also
// campaign verification's `completeLabel` when it is mounted inside the
// gate, so the candidate lands back on the same word regardless of which
// gate screen sent them there.
export const GATE_NOTICE_COPY = {
  inReviewSavedLine: (noun: string): string =>
    `Your ${noun} stays saved. We tell you when it clears.`,
  backToNoun: (noun: string): string => `Back to my ${noun}`,
}
