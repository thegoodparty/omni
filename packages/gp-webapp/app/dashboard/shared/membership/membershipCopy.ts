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
    free: '$10 a month',
    needsVerification: 'Verification needed',
    inReview: 'Verification in review',
    awaitingPin: 'Enter your PIN',
  },
  pitch: {
    title: 'A complete voter outreach toolkit, built for political campaigns',
    body: 'Pro gives you the data and tools to find voters, reach them, understand what matters, and decide what to do next.',
    join: 'Join Pro for $10 a month',
    dismiss: 'Continue without Pro',
    tiles: [
      {
        title: 'Voter data for your race',
        body: 'Find the voters most relevant to your campaign and create targeted lists.',
      },
      {
        title: 'Texts, robocalls, and polls',
        body: 'Introduce yourself, share your message, and learn which issues matter most to voters.',
      },
      {
        title: 'Door-knocking tools',
        body: 'Get routes, addresses, and voter details so you or your volunteers can meet people face to face.',
      },
      {
        title: 'Social media content',
        body: 'Use ready-made templates to stay visible and communicate consistently.',
      },
      {
        title: 'Political texting support',
        body: 'Get help with the verification and carrier requirements needed to send campaign messages.',
      },
      {
        title: 'Insights and next steps',
        body: 'Understand your results quickly and get practical recommendations for your next move.',
      },
    ],
  },
} as const
