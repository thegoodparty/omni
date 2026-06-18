import type { CampaignStorySection } from './components/CampaignStoryCard'

// Single source of truth for the three Campaign Story prompts. The story page
// uses the full prompt UX (title + description + placeholder); the plan-tab
// review uses just id + title. Keeping one list prevents the labels drifting
// between the two surfaces.
export const CAMPAIGN_STORY_SECTIONS: CampaignStorySection[] = [
  {
    id: 'why',
    title: 'Your why',
    description:
      'The moment, the people, the breaking point: your stump-speech opener.',
    placeholder:
      'Tap to write: what pushed you to put your name on the ballot?',
  },
  {
    id: 'background',
    title: 'Your background',
    description:
      'Childhood, career, community ties. The human story behind the candidate.',
    placeholder: 'Tap to write: your background, career, and what shaped you.',
  },
  {
    id: 'issues',
    title: 'Your issues',
    description: 'Two to four concrete fights for your first term.',
    placeholder:
      "Tap to write: the 2-4 issues you'd spend political capital on.",
  },
]
