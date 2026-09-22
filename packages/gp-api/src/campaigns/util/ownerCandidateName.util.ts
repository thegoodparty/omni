import { getUserFullName } from 'src/users/util/users.util'
import { CampaignWith } from '@/campaigns/campaigns.types'

// The candidate an outreach message identifies is the campaign OWNER
// (Campaign.user), never the requester — a Campaign Manager drafting on
// someone else's campaign must not become the candidate. Same source as
// requireCompliantScript's server-side standards check.
export const ownerCandidateName = (campaign: CampaignWith<'user'>): string =>
  campaign.user ? getUserFullName(campaign.user) : ''
