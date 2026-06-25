import { COS_INTRO_MESSAGES } from './chat/chatConstants'
import type { OnboardingCardKey } from '../data/contracts'

export interface OnboardingCardConfig {
  eyebrowLabel: string
  title: string
  summary: string
  ctaLabel: string
  /**
   * Display-only assistant messages played when the chat opens from this card,
   * so the agent prompts the user (introduce itself / ask for priorities). Not
   * sent to the model; the real turn begins when the user replies.
   */
  opener: string[]
}

// Render order on the dashboard.
export const ONBOARDING_CARD_ORDER: OnboardingCardKey[] = ['meet', 'priorities']

export const ONBOARDING_CARDS: Record<OnboardingCardKey, OnboardingCardConfig> =
  {
    meet: {
      eyebrowLabel: 'Get started',
      title: 'Meet your virtual chief of staff',
      summary:
        'See how your Chief of Staff can help you prepare for meetings, ' +
        'track priorities, and stay on top of your district.',
      ctaLabel: 'Meet my Chief of Staff',
      opener: COS_INTRO_MESSAGES,
    },
    priorities: {
      eyebrowLabel: 'Get started',
      title: "Tell us more about the most important issues you're facing",
      summary:
        'Share the priorities that matter most so your Chief of Staff can ' +
        'tailor its help to your district.',
      ctaLabel: 'Personalize my Chief of Staff',
      opener: [
        "Let's make sure I'm focused on what matters most to you.",
        'Tell me the top priorities you want me to keep front and center — ' +
          'the issues, projects, or commitments you care about most.',
        "I'll keep track of them and tailor my help around them.",
      ],
    },
  }
