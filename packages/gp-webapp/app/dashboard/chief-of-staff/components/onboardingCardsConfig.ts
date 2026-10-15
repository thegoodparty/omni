import { buildChiefOfStaffIntro } from './chat/chatConstants'
import type { OnboardingCardKey } from '../data/contracts'

export interface OnboardingCardConfig {
  overlineLabel: string
  title: string
  summary: string
  ctaLabel: string
  /**
   * Display-only assistant messages played when the chat opens from this card,
   * so the agent prompts the user (introduce itself / ask for priorities). Not
   * sent to the model; the real turn begins when the user replies.
   */
  opener: (firstName?: string) => string[]
}

// Render order on the dashboard.
export const ONBOARDING_CARD_ORDER: OnboardingCardKey[] = ['meet', 'priorities']

export const ONBOARDING_CARDS: Record<OnboardingCardKey, OnboardingCardConfig> =
  {
    meet: {
      overlineLabel: 'Get started',
      title: 'Get the staff your office never had',
      summary:
        'Your Chief of Staff does the prep and follow-up, so your time goes ' +
        'to the people you serve.',
      ctaLabel: 'Meet my Chief of Staff',
      opener: buildChiefOfStaffIntro,
    },
    priorities: {
      overlineLabel: 'Get started',
      title: 'Get help focused on what you care about',
      summary:
        'Your Chief of Staff keeps the right issues in front of you once it ' +
        'knows your priorities.',
      ctaLabel: 'Personalize my Chief of Staff',
      opener: () => [
        "Let's make sure I'm focused on what matters most to you.",
        'Tell me the top priorities you want me to keep front and center: ' +
          'the issues, projects, or commitments you care about most.',
        "I'll keep track of them and tailor my help around them.",
      ],
    },
  }
