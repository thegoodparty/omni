// One community training per outreach moment, from the community team's
// "Community resource → product map": the purpose the candidate picked wins
// when it has a training of its own, the channel fills the gap when it does
// not, and the resource library is the fallback. One recommendation at a
// time — the value is "you're doing this right now, so here's the one thing
// that can help", not a reading list.
//
// Win only. The trainings live in the candidate community, so no Serve
// surface mounts the link (see CommunityResourceLink's callers).

export type CommunityResourceChannel =
  | 'sms'
  | 'robocall'
  | 'social'
  | 'phone-bank'
  | 'door'

export type CommunityResourceKind = 'course' | 'webinar' | 'library'

type CommunityResourceId = 'messaging' | 'gotv' | 'voter-contact' | 'library'

export interface CommunityResource {
  id: CommunityResourceId
  kind: CommunityResourceKind
  href: string
  // The one sentence or two shown beside the link.
  line: string
}

const CIRCLE = 'https://goodpartyorg.circle.so'

const RESOURCES: Record<
  CommunityResourceId,
  Pick<CommunityResource, 'id' | 'kind' | 'href'>
> = {
  messaging: {
    id: 'messaging',
    kind: 'webinar',
    href: `${CIRCLE}/c/video-trainings/win-your-race-messaging-that-moves-voters`,
  },
  gotv: {
    id: 'gotv',
    kind: 'course',
    href: `${CIRCLE}/c/win/sections/980444/lessons/3719939`,
  },
  'voter-contact': {
    id: 'voter-contact',
    kind: 'course',
    href: `${CIRCLE}/c/win/sections/980444/lessons/3719934`,
  },
  library: {
    id: 'library',
    kind: 'library',
    href: `${CIRCLE}/c/resources`,
  },
}

interface Recommendation {
  resource: CommunityResourceId
  line: string
}

// Keyed by the shared OUTREACH_PURPOSE_VALUES slugs. A purpose missing here
// (event_invite, custom, and every Serve-only slug) has no training of its
// own and falls through to the channel.
const PURPOSE_RECOMMENDATIONS: Partial<Record<string, Recommendation>> = {
  introduce_myself: {
    resource: 'messaging',
    line: 'Make your introduction count. Learn how to build a message that connects with voters.',
  },
  persuade_voters: {
    resource: 'messaging',
    line: 'Strengthen your voter conversations with messaging that moves people.',
  },
  early_voting: {
    resource: 'gotv',
    line: 'Get ready for GOTV with a step-by-step turnout strategy.',
  },
  election_day_turnout: {
    resource: 'gotv',
    line: 'Get ready for GOTV with a step-by-step turnout strategy.',
  },
}

const VOTER_CONTACT_LINE =
  'Build confidence before reaching voters with our Voter Contact training.'

const CHANNEL_RECOMMENDATIONS: Record<
  CommunityResourceChannel,
  Recommendation
> = {
  door: {
    resource: 'voter-contact',
    line: 'Heading to the doors? Learn the basics of effective voter conversations.',
  },
  'phone-bank': { resource: 'voter-contact', line: VOTER_CONTACT_LINE },
  sms: { resource: 'voter-contact', line: VOTER_CONTACT_LINE },
  robocall: { resource: 'voter-contact', line: VOTER_CONTACT_LINE },
  // Social has no voter-contact training behind it, so it gets the library.
  social: {
    resource: 'library',
    line: 'Browse the resource library for trainings on every part of your campaign.',
  },
}

export const communityResourceFor = (
  channel: CommunityResourceChannel,
  purpose: string | null | undefined,
): CommunityResource => {
  const recommendation =
    (purpose ? PURPOSE_RECOMMENDATIONS[purpose] : undefined) ??
    CHANNEL_RECOMMENDATIONS[channel]
  return { ...RESOURCES[recommendation.resource], line: recommendation.line }
}

const CTA_LABELS: Record<CommunityResourceKind, string> = {
  course: 'Open course',
  webinar: 'Open webinar',
  library: 'Open resource library',
}

export const communityResourceCta = (kind: CommunityResourceKind): string =>
  CTA_LABELS[kind]
