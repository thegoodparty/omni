import type { SocialPurpose } from '@goodparty_org/contracts'
import type { Campaign } from 'helpers/types'

export const SOCIAL_TONES = ['Warm', 'Direct', 'Urgent', 'Friendly'] as const
export type SocialTone = (typeof SOCIAL_TONES)[number]

export const campaignOfficeName = (campaign: Campaign | null): string =>
  campaign?.details?.normalizedOffice ||
  campaign?.positionName ||
  campaign?.office ||
  'local office'

// Local starter drafts, seeded on purpose selection and cycled by
// Regenerate / tone changes. Deliberately client-side: the compose step
// edits the draft locally — the one LLM call happens later, when the
// confirmed draft is adapted per platform. Copy is issue-neutral so it
// can't put a position in a candidate's mouth; the user edits before
// anything is generated or saved.
const DRAFTS: Record<SocialPurpose, ((office: string) => string)[]> = {
  introduce_myself: [
    (office) =>
      `I'm running for ${office} because I'm a neighbor first — I live here, and I want local government to work for the people who live here too. Over the next few weeks I want to hear what matters most to you.`,
    (office) =>
      `Hi neighbors — I'm running for ${office} because our community deserves leaders who show up, listen, and get the basics right. I'd love to hear from you.`,
  ],
  persuade_voters: [
    (office) =>
      `This race is close, and it will come down to neighbors like you. I'm running for ${office}, focused on the things that shape our daily lives here. I'd be grateful for your vote.`,
    (office) =>
      `Change starts local. I'm running for ${office} to put our community first — and this one comes down to a handful of votes. I'd be honored to have yours.`,
  ],
  event_invite: [
    (office) =>
      `Come say hi! I'm hosting a neighborhood gathering this week — a chance to meet, ask questions, and share what you'd like to see from your next ${office}. Bring a friend and a question.`,
    (office) =>
      `Let's talk in person. I'm holding a community meetup this week — no speeches, just neighbors sharing what matters. Stop by and tell me what you'd like to see from your next ${office}.`,
  ],
  early_voting: [
    () =>
      `Early voting is open now. It's the easiest way to make your voice heard without waiting in line on Election Day. Make a plan to vote early — and tell a friend to do the same.`,
    () =>
      `Don't wait for Election Day. Early voting is open and it only takes a few minutes. Make your plan today, and bring a neighbor with you — every early vote helps.`,
  ],
  election_day_turnout: [
    () =>
      `Today is the day. This race will come down to turnout — if you haven't voted yet, now is the time. Your vote decides our future.`,
    () =>
      `It's Election Day! This one comes down to who shows up. If you haven't voted yet, grab a neighbor and go — every single vote matters.`,
  ],
  issue_update: [
    (office) =>
      `A quick update from the campaign: I've been out talking with neighbors about what matters most in our community, and I want you to know where things stand. As your next ${office}, I'll keep showing up and listening — because the people who live here should come first.`,
    (office) =>
      `Straight talk: too many local decisions get made without the people they affect. I'm running for ${office} to change that — and I'll keep listening every step of the way.`,
  ],
  custom: [],
}

export const generateSocialDraft = (
  purpose: SocialPurpose,
  office: string,
  seed = 0,
): string => {
  const drafts = DRAFTS[purpose]
  if (!drafts || drafts.length === 0) return ''
  return (drafts[seed % drafts.length] ?? drafts[0])?.(office) ?? ''
}
