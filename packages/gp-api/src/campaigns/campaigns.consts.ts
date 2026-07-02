export const VOTER_GOALS_ADVISORY_LOCK_KEY = 918_274

// Serializes follow-on campaign creation per user so two concurrent requests
// can't both pass the eligibility re-check and each create a campaign.
export const FOLLOW_ON_CAMPAIGN_ADVISORY_LOCK_KEY = 918_276

// Serializes tracker static-task materialization per campaign. The plan endpoint
// that triggers it is polled, so two concurrent first-loads could otherwise both
// see zero static rows and each insert the full catalog. 918_278 is distinct from
// every other advisory-lock first arg (918_273-277, incl. electedOffice's 277) so
// the (key, campaignId) pair can't collide with another domain's (key, userId).
export const TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY = 918_278
