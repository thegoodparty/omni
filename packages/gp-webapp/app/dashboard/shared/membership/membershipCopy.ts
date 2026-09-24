export const MEMBERSHIP_COPY = {
  banner: {
    free: {
      body: 'Unlock voter data and outreach for $10 a month.',
      cta: 'See what you get',
    },
    needsVerification: {
      body: 'Verify your campaign to send texts.',
      cta: 'Start verification',
    },
    inReview: {
      body: "Verification is in review. We'll email you in 3-7 business days when approved.",
      cta: null,
    },
    awaitingPin: {
      body: 'You will be sent a PIN within 7 business days to either your email, phone or address.',
      cta: 'Enter your PIN',
    },
  },
  chip: {
    // The free chip reads as three inline parts so the Pro badge sits between
    // the words rather than leading them: "Join [PRO] for $10/mo".
    joinLead: 'Join',
    joinTail: 'for $10/mo',
    needsVerification: 'Verification needed',
    inReview: 'Verification in review',
    awaitingPin: 'Enter your PIN',
  },
  pitch: {
    title: 'Join Pro to unlock voter data and outreach',
    pill: '$10 per month, cancel anytime',
    join: 'Join Pro',
    tiles: [
      {
        title: 'Voter data',
        body: 'Find the voters most relevant to your campaign and create targeted lists.',
      },
      {
        title: 'Robocalls & phone banking',
        body: 'Introduce yourself, share your message, and learn which issues matter most to voters.',
      },
      {
        title: 'Door-knocking tools',
        body: 'Get routes, addresses, and voter details so you or your volunteers can meet people face to face.',
      },
      {
        title: 'Campaign verification',
        body: 'Get help with the verification and carrier requirements needed to send campaign messages.',
      },
    ],
  },
} as const
