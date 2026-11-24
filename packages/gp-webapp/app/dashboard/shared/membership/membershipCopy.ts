import { PLAN_PRICING } from '@goodparty_org/contracts'
import { formatPlanCents, type PlanPitch } from '../plan/planPitch'

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
    cleared: {
      body: 'Your campaign is verified. Schedule your text to voters.',
      cta: 'Schedule your text',
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
    cleared: 'Schedule your text',
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

// Flag on: the pitch rows, one line each (design: GpdPitchProDesk). Team adds
// its logins row first.
export const PLAN_PITCH_ROWS = {
  team: {
    title: 'Logins for your team',
    body: 'Your campaign manager and volunteers each get their own login.',
  },
  voterData: {
    title: 'Voter data',
    body: 'Find the voters who matter and build targeted lists.',
  },
  outreach: {
    title: 'Texts and robocalls',
    body: 'Introduce yourself and share your message.',
  },
  doors: {
    title: 'Door knocking and phone banking',
    body: 'Routes and call lists for you and your volunteers.',
  },
  verification: {
    title: 'Campaign verification',
    body: 'We register your campaign with the carriers so your texts go through.',
  },
} as const

// Flag on (win_per_campaign_pricing): the pitched plan and its price come from
// PLAN_PRICING through the PlanPitch, never literals.
export const membershipPlanCopy = (
  pitch: PlanPitch,
): {
  bannerFree: { body: string; cta: string }
  chipJoinTail: string
  pitchTitle: string
  pitchPill: string
  pitchJoin: string
} => ({
  bannerFree: {
    body:
      pitch.plan === 'team'
        ? `Unlock voter data and outreach for your whole team for ${pitch.price}. Good for your whole campaign.`
        : `Unlock voter data and outreach with ${pitch.name} for ${pitch.price}. Good for your whole campaign.`,
    cta: MEMBERSHIP_COPY.banner.free.cta,
  },
  chipJoinTail: `for ${pitch.price}`,
  pitchTitle: `Join ${pitch.name} to unlock voter data and outreach`,
  pitchPill: `${pitch.price}, one payment for your whole campaign`,
  pitchJoin: `Join ${pitch.name} for ${pitch.price}`,
})

// Flag on: Invite on a gated campaign opens the Team pitch from Free and the
// Team cross-sell from Pro (design: G-AcctTeamProInvite and ...InviteCross).
// Both reuse the gate layout: a headline row, then check bullets. From Pro only
// the difference is charged and the pitch drops what Pro already has.
export const teamInvitePitchCopy = (
  fromPro: boolean,
): {
  title: string
  headline: string
  bullets: { text: string; bonus?: boolean }[]
  join: string
} => {
  const price = formatPlanCents(
    fromPro
      ? PLAN_PRICING.teamCents - PLAN_PRICING.proCents
      : PLAN_PRICING.teamCents,
  )
  const logins = [
    { text: 'A campaign manager login to help you share the load' },
    { text: 'Volunteer logins to walk door-knocking turfs' },
  ]
  return {
    title: 'Upgrade to invite your campaign team',
    headline: 'Bring your campaign manager and volunteers in',
    bullets: fromPro
      ? [
          { text: `Pay ${price} once to upgrade, good for your whole race` },
          ...logins,
        ]
      : [
          { text: `Pay ${price} once for your plan, good for your whole race` },
          ...logins,
          { text: 'Voter data, texts and robocalls to reach voters' },
          {
            text: `${formatPlanCents(PLAN_PRICING.includedCreditCents)} outreach credit to get started`,
            bonus: true,
          },
        ],
    join: fromPro ? `Upgrade to Team for ${price}` : `Join Team for ${price}`,
  }
}

// Flag off: Invite opens the Team pitch (design: Invite). From Pro only the
// difference is charged, so the pill and the button carry that price.
export const membershipInviteCopy = (
  fromPro: boolean,
): { pitchTitle: string; pitchPill: string; pitchJoin: string } => {
  const price = formatPlanCents(
    fromPro
      ? PLAN_PRICING.teamCents - PLAN_PRICING.proCents
      : PLAN_PRICING.teamCents,
  )
  return {
    pitchTitle: 'Join Team to invite your campaign team',
    pitchPill: fromPro
      ? `${price}, the difference from your Pro plan`
      : `${price}, one payment for your whole campaign`,
    pitchJoin: `Join Team for ${price}`,
  }
}
