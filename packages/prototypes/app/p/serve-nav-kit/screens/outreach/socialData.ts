import {
  type LucideIcon,
  Facebook,
  Instagram,
  Twitter,
  Users,
  Video,
  Youtube,
} from 'lucide-react'

// Social media campaign data. Backend-free: drafts and per-platform assets are
// generated from local templates. Tones are shared with SMS (Warm/Direct/…).

export { type Tone as SocialTone, TONES, TONE_ICONS } from './smsData'

const CANDIDATE_FULL_NAME = 'Renee Wells'
const CANDIDATE_ROLE_SHORT = 'City Council'
const SHARE_URL = 'https://goodparty.org/renee-wells'

export type SocialMode = 'copy' | 'script'

export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'nextdoor'
  | 'x'
  | 'tiktok'
  | 'youtube-shorts'

export type PlatformMeta = {
  id: SocialPlatform
  label: string
  helper: string
  icon: LucideIcon
  kind: SocialMode
}

// One tile per destination. "copy" = post text, "script" = video teleprompter.
export const ALL_PLATFORMS: PlatformMeta[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    helper: 'Post copy',
    icon: Facebook,
    kind: 'copy',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    helper: 'Post copy',
    icon: Instagram,
    kind: 'copy',
  },
  {
    id: 'nextdoor',
    label: 'Nextdoor',
    helper: 'Post copy',
    icon: Users,
    kind: 'copy',
  },
  { id: 'x', label: 'X', helper: 'Post copy', icon: Twitter, kind: 'copy' },
  {
    id: 'tiktok',
    label: 'TikTok',
    helper: 'Video script',
    icon: Video,
    kind: 'script',
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    helper: 'Video script',
    icon: Youtube,
    kind: 'script',
  },
]

export const ALL_PLATFORM_IDS: SocialPlatform[] = ALL_PLATFORMS.map((p) => p.id)

export const metaFor = (platform: SocialPlatform): PlatformMeta =>
  ALL_PLATFORMS.find((p) => p.id === platform) ?? ALL_PLATFORMS[0]!

export type SocialPurposeId =
  | 'introduce'
  | 'persuade'
  | 'event'
  | 'vote-early'
  | 'election-day'
  | 'issue'
  | 'thank-you'

export const SOCIAL_PURPOSES: { id: SocialPurposeId; label: string }[] = [
  { id: 'introduce', label: 'Introduce myself' },
  { id: 'persuade', label: 'Persuade likely voters' },
  { id: 'event', label: 'Invite people to a local event' },
  { id: 'vote-early', label: 'Encourage early voting' },
  { id: 'election-day', label: 'Election day turnout' },
  { id: 'issue', label: 'Share an issue update' },
  { id: 'thank-you', label: 'Write my own message' },
]

export const socialPurposeLabel = (id: SocialPurposeId): string =>
  SOCIAL_PURPOSES.find((p) => p.id === id)?.label ?? 'Social post'

// Multiple real drafts per purpose so "Regenerate" (and switching tone) yields
// new copy each time.
const DRAFTS: Record<SocialPurposeId, string[]> = {
  introduce: [
    `I'm ${CANDIDATE_FULL_NAME}, and I'm running for ${CANDIDATE_ROLE_SHORT}. I'm a neighbor first — I've lived here for years and I'm running to make local government actually work for the people who live here. Over the next few weeks I want to hear what matters most to you.`,
    `Hi neighbors — I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}. I'm running because our community deserves leaders who show up, listen, and get the basics right: affordable housing, safe streets, and a city hall that works. I'd love to hear from you.`,
  ],
  persuade: [
    `This race is close, and it will come down to neighbors like you. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, focused on the things that shape our daily lives — housing, safety, and a city hall that listens. I'd be grateful for your vote.`,
    `Change starts local. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I'll fight to lower everyday costs and keep our neighborhoods safe. This one comes down to a handful of votes — I'd be honored to have yours.`,
  ],
  event: [
    `Come say hi! I'm hosting a neighborhood gathering this week — a chance to meet, ask questions, and share what you'd like to see from your next ${CANDIDATE_ROLE_SHORT}. Bring a friend and a question.`,
    `Let's talk in person. I'm holding a community meetup this week — no speeches, just neighbors sharing what matters. Stop by, bring a friend, and tell me what you'd like to see from your next ${CANDIDATE_ROLE_SHORT}.`,
  ],
  'vote-early': [
    `Early voting is open now. It's the easiest way to make your voice heard without waiting in line on Election Day. Make a plan to vote early — and text a friend to do the same.`,
    `Don't wait for Election Day. Early voting is open and it only takes a few minutes. Make your plan today, and bring a neighbor with you — every early vote helps.`,
  ],
  'election-day': [
    `Today is the day. Polls are open until 7:30 PM and this race will come down to turnout. If you haven't voted yet, now is the time — your vote decides our future.`,
    `It's Election Day! Polls close at 7:30 PM. This one comes down to who shows up — if you haven't voted yet, grab a neighbor and go. Every single vote matters.`,
  ],
  issue: [
    `Here's where I stand: our neighborhood deserves real action on housing and safety, not more talk. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I'll keep showing up and listening — because the people who live here should come first.`,
    `Straight talk: too many decisions get made without the people they affect. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I'll put housing, safety, and everyday costs first — and keep listening every step of the way.`,
  ],
  'thank-you': [],
}

export const generateSocialDraft = (
  purpose: SocialPurposeId,
  seed = 0,
): string => {
  const drafts = DRAFTS[purpose]
  if (!drafts || drafts.length === 0) return ''
  return drafts[seed % drafts.length] ?? drafts[0]!
}

const firstSentence = (text: string): string => {
  const m = text.match(/^[^.!?]*[.!?]/)
  return (m ? m[0] : text).trim()
}

const HASHTAGS = '#LocalElections #CommunityFirst'

// Adapt the shared draft into each platform's voice/length. Post platforms get
// tailored copy; video platforms get a teleprompter script plus a caption.
export const generateSocialAssets = (
  draft: string,
  platforms: SocialPlatform[],
): Record<string, { content: string; caption?: string }> => {
  const body = draft.trim()
  const out: Record<string, { content: string; caption?: string }> = {}
  for (const id of platforms) {
    if (id === 'facebook') {
      out[id] = {
        content: `${body}\n\nLearn more and get involved: ${SHARE_URL}`,
      }
    } else if (id === 'instagram') {
      out[id] = { content: `${body}\n\n${HASHTAGS} #Instagram` }
    } else if (id === 'nextdoor') {
      out[id] = {
        content: `Hi neighbors — ${body[0]?.toLowerCase() ?? ''}${body.slice(1)}`,
      }
    } else if (id === 'x') {
      const short =
        body.length > 230 ? `${body.slice(0, 227).trimEnd()}…` : body
      out[id] = { content: `${short}\n${SHARE_URL}` }
    } else if (id === 'tiktok') {
      out[id] = {
        content: `Hey — quick one. ${body} If that resonates, follow along and share this with a neighbor.`,
        caption: `${firstSentence(body)} ${HASHTAGS} #TikTok`,
      }
    } else if (id === 'youtube-shorts') {
      out[id] = {
        content: `Hi, I'm ${CANDIDATE_FULL_NAME}. ${body} Subscribe to follow the campaign and share this with someone who cares about our community.`,
        caption: `${firstSentence(body)} ${HASHTAGS} #Shorts`,
      }
    }
  }
  return out
}

export { SHARE_URL }
