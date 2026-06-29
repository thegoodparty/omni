/**
 * ⚠️  HUBSPOT INTEGRATION WARNING - USE CAUTION WHEN EDITING EVENT NAMES ⚠️
 *
 * Many of these event names are used by HubSpot workflows to track user status
 * and trigger email sequences. Changing event names will break the integration.
 *
 * Critical events for 10DLC Compliance flow:
 *   - 'Voter Outreach - 10DLC Compliance Completed' → Sets status to "Compliant"
 *
 * If you need to change an event name:
 * 1. Update the corresponding HubSpot workflow trigger to match
 * 2. Test the full flow: App → Segment → HubSpot → Workflow triggers
 * 3. Verify the affected HubSpot fields update correctly
 *
 */
export const EVENTS = {
  Account: {
    PasswordResetRequested: 'Account - Password Reset Requested',
    ProSubscriptionConfirmed: 'Account - Pro Subscription Confirmed',
    ProUpgradeComplete: 'pro_upgrade_complete',
    UserDeleted: 'Account - User Deleted',
  },
  Onboarding: {
    UserCreated: 'Onboarding - User Created',
    // Top of the magic-link funnel. Emitted when sales generates an onboarding
    // magic link for a lead, keyed to the provisioned user id + email. A single
    // funnel event for both flows — the `type` property ('serve' | 'win')
    // distinguishes the elected-official (serve) link from the candidate (win)
    // link. The downstream record (EO or campaign) may not exist yet at send
    // time. Paired client-side with 'Onboarding - Magic Link Clicked'
    // (gp-webapp). Renamed from 'Serve Onboarding -'/'Win Onboarding - Magic
    // Link Sent'.
    MagicLinkSent: 'Onboarding - Magic Link Sent',
  },
  //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows for 10DLC compliance tracking
  // Used in: https://app.hubspot.com/workflows/21589597/platform/flow/1739287110/edit
  CandidateWebsite: {
    Published: 'Candidate Website - Published',
    PurchasedDomain: 'Candidate Website - Purchased domain',
  },
  Outreach: {
    //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows for 10DLC compliance tracking
    ComplianceCompleted: 'Voter Outreach - 10DLC Compliance Completed',
    //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows for 10DLC compliance tracking
    ComplianceFormSubmitted: 'Voter Outreach - 10DLC Compliance Form Submitted',
    //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows for 10DLC compliance tracking
    CompliancePinSubmitted: 'Voter Outreach - 10DLC Compliance PIN Submitted',
    FreeTextsOfferRedeemed: 'Voter Outreach - Free Texts Offer Redeemed',
    CampaignVerifyTokenStatusUpdate: 'Campaign Verify Token Status Update',
  },
  AiContent: {
    GenerationStarted: 'Content Builder: Generation Started',
    ContentGenerated: 'Content Builder: Generation Completed',
  },
  Polls: {
    ResultsSynthesisCompleted: 'Poll - Results Synthesis Complete',
  },
  Campaigns: {
    FollowOnCreated: 'Campaign - Follow-On Created',
    FollowOnBlocked: 'Campaign - Follow-On Blocked',
  },
  CampaignPlan: {
    //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows for weekly task digest emails
    WeeklyTasksDigest: 'Campaign Plan - Weekly Tasks Digest',
  },
  // Server-side generation for the V2 onboarding campaign plan. The strategic
  // landscape (CAP/PMF engine) fans out into two independent agent jobs, so it
  // gets four events. The webapp's view of these is tracked separately under
  // `Onboarding V2 -` in gp-webapp.
  CampaignPlanV2: {
    MediaGenerationStarted: 'Campaign Plan V2 - Media Generation Started',
    MediaGenerationCompleted: 'Campaign Plan V2 - Media Generation Completed',
    CommunityEventsGenerationStarted:
      'Campaign Plan V2 - Community Events Generation Started',
    CommunityEventsGenerationCompleted:
      'Campaign Plan V2 - Community Events Generation Completed',
    OppositionResearchGenerationStarted:
      'Campaign Plan V2 - Opposition Research Generation Started',
    OppositionResearchGenerationCompleted:
      'Campaign Plan V2 - Opposition Research Generation Completed',
    OpportunitiesChallengesGenerationStarted:
      'Campaign Plan V2 - Opportunities & Challenges Generation Started',
    OpportunitiesChallengesGenerationCompleted:
      'Campaign Plan V2 - Opportunities & Challenges Generation Completed',
    StrategyRaceChanged: 'Campaign Plan V2 - Strategy Race Changed',
  },
  // Campaign AI assistant streaming. The browser only sees a message *sent*;
  // these are the server-truth outcomes of the SSE stream the client cannot
  // honestly observe. The webapp's send/click events live under `AI Assistant`
  // in gp-webapp.
  AiChat: {
    ResponseCompleted: 'AI Assistant - Response Completed',
    ResponseFailed: 'AI Assistant - Response Failed',
  },
  // Know Your Opponent (Win). SelfResearchCompleted is server-truth: it fires
  // when the self-research agent job lands its findings and the pass reaches
  // completed (the browser only sees the job start). ContrastUsed fires when a
  // candidate routes an approved contrast into their Campaign Story or a draft
  // texting Outreach — a DRAFT only, marking intent to use a contrast, not a
  // send. ContrastEdited fires when the candidate edits a cleared or approved
  // contrast's text before routing it.
  RaceOpponent: {
    SelfResearchCompleted: 'Win - Self Research Completed',
    ContrastUsed: 'Win - Contrast Used',
    ContrastEdited: 'Win - Contrast Edited',
  },
  // Community issues (Serve). The agent jobs generate the feed server-side; the
  // browser only sees a job *start*. These fire on job completion and carry the
  // issue headline + summary so a downstream email (HubSpot) can render them.
  CommunityIssues: {
    InitialIssuesGenerated: 'Community Issues - Initial Issues Generated',
    HighPriorityTrendingIssueCreated:
      'Community Issues - High Priority Trending Issue Created',
    TopIssuePriorityChanged: 'Community Issues - Top Issue Priority Changed',
  },
}

export type UserContext = {
  email?: string
  hubspotId?: string
}

// TODO: Define event properties w/ a generic type. No reason this has to be a
//  Record<string, unknown>
//  https://goodparty.atlassian.net/browse/WEB-4530
export type SegmentTrackEventProperties = Record<string, unknown>

// TODO: same here, we should define the traits for the identity profile. No need
//  for a generic type here and should need Record<string, unknown>
//  https://goodparty.atlassian.net/browse/WEB-4530
export type SegmentIdentityTraits = Record<string, unknown>

// Campaign-scoped facts carried on a Segment group() keyed on the org slug.
// These are per-campaign, not person-level, so they must never be written to
// the user identify (that overwrites a prior campaign's values on a user who
// runs again).
export type SegmentGroupTraits = {
  officeMunicipality?: string
  officeElectionDate?: string
  affiliation?: string
}
