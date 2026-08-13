import type { CampaignStory } from '@goodparty_org/contracts'

export type CampaignStoryField = keyof CampaignStory

export interface CampaignStorySection {
  id: CampaignStoryField
  title: string
  description: string
  placeholder: string
  // Default example shown in the "Here's an example" accordion.
  example: string
}

// Single source of truth for the textarea Campaign Story prompts. `why` is not
// here — it edits the website bio (shared with Pro-upgrade); only `background`
// is a plain-text story field. The plan-tab review (`CampaignPlanStoryGate`)
// uses just id + title.
export const CAMPAIGN_STORY_SECTIONS: CampaignStorySection[] = [
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
