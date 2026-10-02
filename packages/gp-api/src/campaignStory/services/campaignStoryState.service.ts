import { createHash } from 'crypto'
import { Injectable } from '@nestjs/common'
import { WebsitesService } from '@/websites/services/websites.service'
import { serializeWebsiteBio } from '@/websites/util/serializeWebsiteBio.util'
import { cleanWebsiteIssues } from '@/websites/util/serializeWebsiteIssues.util'
import { CampaignStoryService } from './campaignStory.service'

export type StoryField = 'why' | 'background' | 'positions'

// The three Campaign Story answers, sourced exactly as the story page sources
// them: `why` is the website bio, `background` is the campaign_story field, and
// `positions` are the website issues. `missing` mirrors the story page's
// completeness gate (why + background + at least one position).
export interface StoryState {
  why: string | null
  background: string | null
  // Read from the website issues, a lenient PrismaJson shape (entries may be
  // partial). Saves use the strict StoryPosition.
  positions: { title?: string; description?: string }[]
  complete: boolean
  missing: StoryField[]
}

// What the plan was generated from, reduced to one comparable string. The
// campaign plan regenerates when this changes, so what it includes IS the
// definition of "the candidate changed their story".
//
// Every field is hashed in the form the plan was actually generated from, not
// the form it was stored in. Both the bio and the issue descriptions are Quill
// HTML, and the same answer reaches us as markup from the story page and as
// plain text from the chat — so hashing raw would bill a regeneration for
// bolding a word, or for answering the same question in the other surface.
// `serializeWebsiteBio` and `cleanWebsiteIssues` are the two places that
// markup is undone, and the agents' params already go through them.
//
// Positions keep their pair structure and their stored order: reordering is a
// real change, since the plan's priorities follow that order.
//
// Deliberately not a stable JSON stringify of StoryState: `complete` and
// `missing` are derived, and including them would make the fingerprint move
// for reasons that are not edits.
export const fingerprintStory = (state: StoryState): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        serializeWebsiteBio(state.why),
        state.background?.trim() ?? '',
        cleanWebsiteIssues(state.positions).map(({ title, description }) => [
          title,
          description,
        ]),
      ]),
    )
    .digest('hex')

// One reader for "what has the candidate told us, and is it complete". The
// answer spans two tables, so every consumer that asks the question has to
// join them the same way or the product disagrees with itself about whether a
// story is finished.
@Injectable()
export class CampaignStoryStateService {
  constructor(
    private readonly stories: CampaignStoryService,
    private readonly websites: WebsitesService,
  ) {}

  async read(campaignId: number): Promise<StoryState> {
    const [story, why, positions] = await Promise.all([
      this.stories.getForCampaign(campaignId),
      this.websites.getBioForCampaign(campaignId),
      this.websites.getIssuesForCampaign(campaignId),
    ])
    const missing: StoryField[] = []
    // The bio is Quill HTML, so a bare `.trim()` reads an empty editor
    // (`<p></p>`, `<p>&nbsp;</p>`) as answered. The webapp strips markup before
    // measuring the same field, so trimming here would let the two sides
    // disagree about whether a story is finished — which is the exact failure
    // this one reader exists to prevent.
    if (!serializeWebsiteBio(why)) missing.push('why')
    if (!story.background?.trim()) missing.push('background')
    if (positions.length === 0) missing.push('positions')
    return {
      why,
      background: story.background,
      positions,
      complete: missing.length === 0,
      missing,
    }
  }
}
