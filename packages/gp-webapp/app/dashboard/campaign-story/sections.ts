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
    example:
      'I spent fifteen years running the family hardware store on Main Street, and I watched our downtown empty out while the council handed tax breaks to out-of-town developers. The last straw was when they cut funding for the after-school program my own kids relied on. I decided I was done complaining at the kitchen table and ready to do something about it.',
  },
  {
    id: 'background',
    title: 'Your background',
    description:
      'Childhood, career, community ties. The human story behind the candidate.',
    placeholder: 'Tap to write: your background, career, and what shaped you.',
    example:
      "I grew up here, graduated from Lincoln High, and put myself through community college working nights. For the last decade I've run a small business, coached youth soccer, and served on the parks advisory board. I'm not a career politician. I'm a neighbor who knows what it takes to make a budget work and show up when people need help.",
  },
]
