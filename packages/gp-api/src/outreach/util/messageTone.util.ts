import { SocialTone } from '@goodparty_org/contracts'

// Shared across every stateless compose endpoint (social, phone banking) —
// the tone vocabulary is the same regardless of channel.
export const TONE_STYLES: Record<SocialTone, string> = {
  warm:
    'Warm: caring and personal. Lead with connection to neighbors and ' +
    'community; gentle, encouraging language.',
  direct:
    'Direct: plain and to the point. Short sentences, a clear ask, no ' +
    'filler or hedging.',
  urgent:
    'Urgent: time matters. Convey momentum and a now-or-never stake ' +
    'without being alarmist.',
  friendly:
    'Friendly: upbeat and approachable. Conversational, light, like a ' +
    'note to a friend.',
}
