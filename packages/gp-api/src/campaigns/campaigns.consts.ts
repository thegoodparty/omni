export const VOTER_GOALS_ADVISORY_LOCK_KEY = 918_274

// Serializes follow-on campaign creation per user so two concurrent requests
// can't both pass the eligibility re-check and each create a campaign.
export const FOLLOW_ON_CAMPAIGN_ADVISORY_LOCK_KEY = 918_276
