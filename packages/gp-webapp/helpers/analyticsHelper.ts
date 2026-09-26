import { kebabCase } from 'es-toolkit'
import { segmentTrackEvent } from './segmentHelper'
import cookie from 'js-cookie'
import type { Analytics } from '@segment/analytics-next'
import type { OrganizationRole } from '@goodparty_org/contracts'

let isImpersonating = false
export const setImpersonating = (value: boolean): void => {
  isImpersonating = value
}

let userEmail: string | undefined
export const setUserEmail = (value: string | undefined): void => {
  userEmail = value
}

// Actor identity for the server-side join (ENG-10829/gp-api PR #1674): every
// trackEvent call carries actorUserId + actorRole so a client event can be
// joined to the server-side actor who caused it. Kept as module state (same
// pattern as userEmail/isImpersonating above) and set from SegmentIdentify,
// which already sits inside both UserProvider and OrganizationProvider.
let actorUserId: number | undefined
export const setActorUserId = (value: number | undefined): void => {
  actorUserId = value
}

// null (not undefined) once resolved-but-absent — a signed-in user with no
// selected org still needs a set() call to distinguish "resolved, no org"
// from "never resolved" (undefined stays undefined pre-hydration too, but
// trackEvent below normalizes both to null on the wire).
let actorRole: OrganizationRole | null | undefined
export const setActorRole = (
  value: OrganizationRole | null | undefined,
): void => {
  actorRole = value
}

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

const CLID_KEYS = [
  'fbclid',
  'gclid',
  'ttclid',
  'msclkid',
  'twclid',
  'li_fat_id',
] as const

export const EVENTS = {
  CampaignStory: {
    RewriteRequested: 'Campaign Story - Rewrite Requested',
    RewriteAccepted: 'Campaign Story - Rewrite Accepted',
    RewriteDiscarded: 'Campaign Story - Rewrite Discarded',
    RewriteLimitReached: 'Campaign Story - Rewrite Limit Reached',
  },
  // Know Your Opponent (Win). Browser-observed views and activation moments the
  // candidate drives directly: OpponentProfileViewed fires when the sourced
  // opponent Handbook renders, OpponentActivityViewed when the "what's new"
  // activity stream renders, UpgradeViewed when a non-Pro candidate lands on the
  // locked upgrade pitch, OpponentsManuallyAdded when the manual-entry form is
  // submitted, and ResearchStarted when a research run starts (manual submit or
  // the auto-fired collection that follows discovery). StandoutActionsViewed
  // fires when the "N ways to stand out" cards render on the brief, and
  // StandoutActionClicked when a card's "Send SMS to voters" CTA is clicked —
  // the race-opponent half of the outreach funnel, joining to
  // Outreach.ClickCreate with source 'deep_link' when the composer opens.
  // Together they measure how far candidates get from upgrade through
  // activation to the report. The self-research-completion and contrast events
  // are server-truth and fire from gp-api, not here.
  RaceOpponent: {
    OpponentProfileViewed: 'Win - Opponent Profile Viewed',
    OpponentActivityViewed: 'Win - Opponent Activity Viewed',
    UpgradeViewed: 'Win - Opponent Upgrade Viewed',
    OpponentsManuallyAdded: 'Win - Opponents Manually Added',
    ResearchStarted: 'Win - Opponent Research Started',
    StandoutActionsViewed: 'Win - Opponent Standout Actions Viewed',
    StandoutActionClicked: 'Win - Opponent Standout Action Clicked',
  },
  polls: {
    resultsViewed: 'Polls - Poll Results Overview Viewed',
    issueDetailsViewed: 'Polls - Poll Results Issue Details Viewed',
    lowConfidenceModalClicked: 'Polls - Low Confidence Modal Clicked',
  },
  // Shared across every polls surface that can hard-block on missing
  // constituent data (onboarding, create, expand) — one event with a `source`
  // rather than three near-duplicates.
  Polls: {
    ConstituentDataUnavailableViewed:
      'Polls - Constituent Data Unavailable Viewed',
  },
  createPoll: {
    createPollClicked: 'Polls - Create Poll Clicked',
    pollQuestionViewed: 'Polls - Poll Question Viewed',
    pollQuestionCompleted: 'Polls - Poll Question Completed',
    pollQuestionOptimized: 'Polls - Poll Question Optimized',
    pollBiasDetectionShown: 'Polls - Poll Bias Detection Shown',
    audienceSelectionViewed: 'Polls - Audience Selection Viewed',
    audienceSelectionCompleted: 'Polls - Audience Selection Completed',
    schedulePollViewed: 'Polls - Schedule Poll Viewed',
    schedulePollCompleted: 'Polls - Schedule Poll Completed',
    addImageViewed: 'Polls - Add Image Viewed',
    addImageCompleted: 'Polls - Add Image Completed',
    pollPreviewViewed: 'Polls - Poll Preview Viewed',
    pollPreviewCompleted: 'Polls - Poll Preview Completed',
    paymentViewed: 'Payment - Schedule and Pay Viewed',
    paymentCompleted: 'Payment - Completed',
  },
  expandPolls: {
    recommendationsViewed: 'Polls - Expand Poll Recommendations Viewed',
    recommendationsCompleted: 'Polls - Expand Poll Recommendations Completed',
    reviewViewed: 'Polls - Expand Poll Review Viewed',
    paymentViewed: 'Payment - Review and Pay Screen Viewed',
    paymentCompleted: 'Payment - Completed',
  },

  SignIn: {
    LoginCompleted: 'Sign In: Login Completed',
  },
  SignUp: {
    ClickLogin: 'Sign Up: Click Login',
  },
  Onboarding: {
    RegistrationCompleted: 'Onboarding - Registration Completed',
    // Top of the magic-link funnel. The recipient landed on the redemption
    // page (client-side, fired once on landing) — `/serve/welcome` for the
    // elected-official flow and `/win/welcome` for the candidate flow. Both
    // fire this single event, carrying a `type: 'serve' | 'win'` property that
    // mirrors its server-side funnel sibling "Onboarding - Magic Link Sent"
    // (gp-api), so the sent → clicked rate is a per-flow property filter in
    // Amplitude rather than two separate events. The `Onboarding -` prefix is
    // intentional (a funnel sibling of the Onboarding group, not the per-screen
    // `Serve Onboarding -` stages below).
    MagicLinkClicked: 'Onboarding - Magic Link Clicked',
    OfficeStep: {
      ClickNext: 'Onboarding - Office Step: Click Next',
      ClickBack: 'Onboarding - Office Step: Click Back',
      OfficeSelected: 'Onboarding - Office Step: Office Selected',
      ClickCantSeeOffice: "Onboarding - Office Step: Click Can't See Office",
      OfficeSearched: 'Onboarding - Candidate Office Searched',
      OfficeCompleted: 'Onboarding - Candidate Office Completed',
    },
  },
  ServeOnboarding: {
    GettingStartedViewed: 'Serve Onboarding - Getting Started Viewed',
    MeetYourConstituentsViewed:
      'Serve Onboarding - Meet Your Constituents Viewed',
    SwornInViewed: 'Serve Onboarding - Sworn In Viewed',
    SwornInCompleted: 'Serve Onboarding - Sworn In Completed',
    ConstituencyProfileViewed: 'Serve Onboarding - Constituency Profile Viewed',
    PollValuePropsViewed: 'Serve Onboarding - Poll Value Props Viewed',
    PollStrategyViewed: 'Serve Onboarding - Poll Strategy Viewed',
    AddImageViewed: 'Serve Onboarding - Add Image Viewed',
    PollImageUploaded: 'Serve Onboarding - Poll Image Uploaded',
    PollPreviewViewed: 'Serve Onboarding - Poll Preview Viewed',
    SmsPollSent: 'Serve Onboarding - SMS Poll Sent',
    SuccessPageViewed: 'Serve Onboarding - Success Page Viewed',
    NotEnoughConstituents: 'Serve Onboarding - SMS Poll Creation Failed',
    // Net-new (sales-sent magic link) elected-official onboarding. Completion +
    // diagnostic events that aren't per-screen "Viewed"/"Completed" funnel
    // stages. `NetNewCompleted` is the established completion metric.
    NetNewCompleted: 'Serve Onboarding - Net New Completed',
    BrSuggestionChanged: 'Serve Onboarding - BR Suggestion Changed',
    PartyDesignationBlocked: 'Serve Onboarding - Party Designation Blocked',
    // Per-screen funnel stages, each fired once per view (see
    // ServeOnboardingFlow). Office Status / Party Designation / Office carry the
    // user's selected card title; the *Completed events fire on Continue.
    WelcomeViewed: 'Serve Onboarding - Welcome Viewed',
    OfficeStatusViewed: 'Serve Onboarding - Office Status Viewed',
    PartyDesignationViewed: 'Serve Onboarding - Party Designation Viewed',
    OfficeViewed: 'Serve Onboarding - Office Viewed',
    OfficeCompleted: 'Serve Onboarding - Office Completed',
    ConfirmViewed: 'Serve Onboarding - Confirm Viewed',
    TermDatesViewed: 'Serve Onboarding - Term Dates Viewed',
    KnowYourConstituentsViewed:
      'Serve Onboarding - Know Your Constituents Viewed',
    KnowYourConstituentsCompleted:
      'Serve Onboarding - Know Your Constituents Completed',
    PledgeViewed: 'Serve Onboarding - Pledge Viewed',
    PledgeCompleted: 'Serve Onboarding - Pledge Completed',
  },
  Navigation: {
    Top: {
      ClickLogo: 'Navigation - Top: Click Logo',
      ClickAvatarDropdown: 'Navigation - Top: Click Avatar Dropdown',
      AvatarDropdown: {
        CloseDropdown: 'Navigation - Top - Avatar Dropdown: Close Dropdown',
        ClickProfile: 'Navigation Top - Avatar Dropdown: Click Profile',
        ClickLogout: 'Navigation Top - Avatar Dropdown: Click Logout',
      },
    },
    Dashboard: {
      ClickDashboard: 'Navigation - Dashboard: Click Dashboard',
      ClickMyProfile: 'Navigation - Dashboard: Click My Profile',
      ClickCampaignTeam: 'Navigation - Dashboard: Click Campaign Team',
      ClickCommunity: 'Navigation - Dashboard: Click Community',
      ClickVoterOutreach: 'Navigation - Dashboard: Click Voter Outreach',
      ClickContacts: 'Navigation - Dashboard: Click Contacts',
      ClickPolls: 'Navigation - Dashboard: Click Polls',
      ClickBriefings: 'Navigation - Dashboard: Click Briefings',
      ClickCommunityIssues: 'Navigation - Dashboard: Click Community Issues',
      ClickCampaignPlan: 'Navigation - Dashboard: Click Campaign Plan',
      ClickConstituentOutreach:
        'Navigation - Dashboard: Click Constituent Outreach',
    },
  },

  // Multi-org dashboard switcher (ENG-10377). The follow-on funnel the
  // "run for" actions open is tracked under OnboardingV2 (intent step) and,
  // for the created/blocked outcome, server-side in gp-api.
  OrgSwitcher: {
    RunForOfficeClicked: 'Org Switcher - Run For Office Clicked',
    OrganizationSwitched: 'Org Switcher - Organization Switched',
  },

  // Team accounts (ENG-10816). CampaignSwitched has no properties: it exists
  // purely to measure whether a member with more than one campaign uses the
  // picker to move between them, as distinct from the always-present
  // OrgSwitcher.OrganizationSwitched (which fires for every switch,
  // including a solo owner's).
  Team: {
    CampaignSwitched: 'Team - Campaign Switched',
    InviteModalOpened: 'Team - Invite Modal Opened',
    InviteSubmitted: 'Team - Invite Submitted',
  },

  Dashboard: {
    CampaignPlan: {
      GenerationCompleted: 'Dashboard - Campaign Plan Generation Completed',
      CampaignTrackerViewed: 'Campaign Plan - Campaign Tracker Viewed',
      WeekNavigated: 'Dashboard - Campaign Plan Week Navigated',
      TaskCTAClicked: 'Dashboard - Campaign Plan Task CTA Clicked',
      TaskStatusUpdated: 'Dashboard - Campaign Task Status Updated',
      ViewModeToggled: 'Dashboard - Campaign Plan View Mode Toggled',
      VoterContactDialogViewed: 'Dashboard - Voter Contact Dialog Viewed',
      VoterContactRecorded: 'Dashboard - Voter Contact Recorded',
      MediaRequested: 'Dashboard - Campaign Plan: Media Requested',
      StrategicLandscapeRequested:
        'Dashboard - Campaign Plan: Strategic Landscape Requested',
      MediaResultsReceived: 'Dashboard - Campaign Plan: Media Results Received',
      MediaDisplayed: 'Dashboard - Campaign Plan: Media Displayed',
      StrategicLandscapeResultsReceived:
        'Dashboard - Campaign Plan: Strategic Landscape Results Received',
      StrategicLandscapeDisplayed:
        'Dashboard - Campaign Plan: Strategic Landscape Displayed',
      PlanDownloaded: 'Dashboard - Campaign Plan: Plan Downloaded',
      PlanShared: 'Dashboard - Campaign Plan: Plan Shared',
      CampaignManagerClicked:
        'Dashboard - Campaign Plan: Campaign Manager Clicked',
    },
    PathToVictory: {
      ClickUnderstand:
        'Dashboard - Path to Victory: Click Understand Path to Victory',
      ExitUnderstand:
        'Dashboard - Path to Victory: Exit Understand Path to Victory',
      ClickContactsNeeded:
        'Dashboard - Path to Victory: Click Needed x,xxx Contacts',
      ClickLearnMore: 'Dashboard - Path to Victory: Click Learn More',
      LearnMore: {
        ClickAwareness:
          'Dashboard - Path to Victory: Click Learn More for Awareness',
        ClickContact:
          'Dashboard - Path to Victory: Click Learn More for Contact',
        ClickVote: 'Dashboard - Path to Victory: Click Learn More for Vote',
        Exit: 'Dashboard - Path to Victory: Exit About Phases Modal',
      },
    },
    VoterContact: {
      CampaignCompleted: 'Voter Outreach - Campaign Completed',
      LogProgress: {
        Exit: 'Dashboard - Voter Contact - Log Progress: Exit Log Progress',
        ClickAdd:
          'Dashboard - Voter Contact - Log Progress: Click Add Progress',
      },
      DoorKnocking: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Door Knocking: Click Generate Script',
        ClickGetDoorTargets:
          'Dashboard - Voter Contact - Door Knocking: Click Get Door Targets',
        ClickLogProgress:
          'Dashboard - Voter Contact - Door Knocking: Click Log Progress',
      },
      Texting: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Texting: Click Generate Script',
        ClickScheduleTextCampaign:
          'Dashboard - Voter Contact - Texting: Click Schedule Text Campaign',
        ClickLogProgress:
          'Dashboard - Voter Contact - Texting: Click Log Progress',
        ScheduleCampaign: {
          Exit: 'Schedule Text Campaign: Exit',
          Next: 'Schedule Text Campaign: Next',
          Back: 'Schedule Text Campaign: Back',
          Complete: {
            ReturnToDashboard:
              'Schedule Text Campaign: Complete - Return to Dashboard',
            ReturnToVoterFile:
              'Schedule Text Campaign: Complete - Return to Voter File',
          },
          Audience: {
            CheckAudience: 'Schedule Text Campaign - Audience: Check Audience',
            CheckPoliticalParty:
              'Schedule Text Campaign - Audience: Check Political Party',
            CheckAge: 'Schedule Text Campaign - Audience: Check Age',
            CheckGender: 'Schedule Text Campaign - Audience: Check Gender',
            EnterRequest:
              'Schedule Text Campaign - Audience: Enter Audience Request',
          },
          Script: {
            ClickSaved:
              'Schedule Text Campaign - Script: Click Use a saved script',
            SelectSaved: 'Schedule Text Campaign - Script: Select Saved Script',
            ClickGenerate:
              'Schedule Text Campaign - Script: Click Generate a new script',
            ClickAdd:
              'Schedule Text Campaign - Script: Click Add your own script',
            SubmitAdd: 'Schedule Text Campaign - Script: Submit added script',
          },
        },
      },
      PhoneBanking: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Phone Banking: Click Generate Script',
        ClickGetPhoneTargets:
          'Dashboard - Voter Contact - Phone Banking: Click Get Phone Targets',
        ClickLogProgress:
          'Dashboard - Voter Contact - Phone Banking: Click Log Progress',
      },
      YardSigns: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Yard Signs: Click Generate Script',
        ClickLogProgress:
          'Dashboard - Voter Contact - Yard Signs: Click Log Progress',
      },
      DigitalAdvertising: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Digital Advertising: Click Generate Script',
        ClickExploreSmartAds:
          'Dashboard - Voter Contact - Digital Advertising: Click Explore Smart Ads',
        ClickLogProgress:
          'Dashboard - Voter Contact - Digital Advertising: Click Log Progress',
      },
      DirectMail: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Direct Mail: Click Generate Script',
        ClickGetMailTargets:
          'Dashboard - Voter Contact - Direct Mail: Click Get Mail Targets',
        ClickLogProgress:
          'Dashboard - Voter Contact - Direct Mail: Click Log Progress',
      },
      EventsRallies: {
        ClickGenerateScript:
          'Dashboard - Voter Contact - Events & Rallies: Click Generate Script',
        ClickLogProgress:
          'Dashboard - Voter Contact - Events & Rallies: Click Log Progress',
      },
    },
    ActionHistory: {
      ClickMenu: 'Dashboard - Campaign Action History: Click Menu',
      ClickDelete: 'Dashboard - Campaign Action History: Click Delete',
    },
  },
  ProUpgrade: {
    ClickExit: 'Pro Upgrade: Click exit top nav',
    Banner: {
      ClickUpgrade:
        'Pro Upgrade - Level Up Your Campaign Banner: Click upgrade',
    },
    Modal: {
      Shown: 'Pro Upgrade - Modal: Modal Shown',
      Exit: 'Pro Upgrade - Modal: Exit',
      ClickButton: 'Pro Upgrade - Modal: Click Button',
    },
    CommitteeCheck: {
      HoverEinHelp:
        'Pro Upgrade - Committee Check Page: Hover "EIN number" help',
      ClickUpload: 'Pro Upgrade - Committee Check Page: Click Upload ',
    },
    // Agentic Pro Upgrade → 10DLC compliance funnel (ENG-10294). Kept separate
    // from the legacy Modal / SplashPage / CommitteeCheck events above, which
    // belong to the older upgrade UX. The funnel's submit/checkout-start signals
    // already exist and are reused (Profile.CandidateProfile.SubmitSuccess,
    // Outreach.DlcCompliance.RegistrationSubmitted / PinVerificationCompleted,
    // ProUpgrade.ClickGoToStripe); the "viewed" steps below were the gap.
    Compliance: {
      BannerViewed: 'Pro Upgrade - Banner Viewed',
      BannerGetPro: 'Pro Upgrade - Banner: Click Get Pro',
      TextingSetupBannerViewed: 'Pro Upgrade - Texting Setup Banner Viewed',
      TextingSetupBannerStart:
        'Pro Upgrade - Texting Setup Banner: Click Start',
      LockedItemClicked: 'Pro Upgrade - Locked Item: Click',
      ValuePropViewed: 'Pro Upgrade - Value Prop Viewed',
      ValuePropGetPro: 'Pro Upgrade - Value Prop: Click Get Pro',
      ValuePropMaybeLater: 'Pro Upgrade - Value Prop: Click Maybe later',
      FilingStatusViewed: 'Pro Upgrade - Filing Status Viewed',
      FilingStatusAlreadyFiled:
        'Pro Upgrade - Filing Status: Click already filed',
      FilingStatusNotFiled: 'Pro Upgrade - Filing Status: Click not yet filed',
      FilingInstructionsViewed: 'Pro Upgrade - Filing Instructions Viewed',
      FilingInstructionsEmail:
        'Pro Upgrade - Filing Instructions: Click email this to me',
      FilingInstructionsExit:
        'Pro Upgrade - Filing Instructions: Click continue to dashboard',
      GuidanceViewed: 'Pro Upgrade - Guidance Viewed',
      GuidanceContinue: "Pro Upgrade - Guidance: Click let's go",
      EinViewed: 'Pro Upgrade - EIN Viewed',
      EinContinue: 'Pro Upgrade - EIN: Click continue',
      EinHoverHelp: 'Pro Upgrade - EIN: Hover help',
      EinInstructionsEmail: 'Pro Upgrade - EIN: Click email me these steps',
      CandidateProfileViewed: 'Pro Upgrade - Candidate Profile Viewed',
      FilingDetailsViewed: 'Pro Upgrade - Filing Details Viewed',
      PaymentViewed: 'Pro Upgrade - Payment Viewed',
      SuccessViewed: 'Pro Upgrade - Success Viewed',
      SuccessContinue: 'Pro Upgrade - Success: Click continue',
      PinEntryViewed: 'Pro Upgrade - PIN Entry Viewed',
    },
    // outreach-pro-gating-v2 membership surfaces (Pro upgrade and campaign
    // verification 2.0). Banner/chip carry `tier` and `texting`; clicks carry
    // `action`.
    Membership: {
      BannerViewed: 'Pro Upgrade - Membership Banner Viewed',
      BannerClicked: 'Pro Upgrade - Membership Banner: Click',
      ChipViewed: 'Pro Upgrade - Membership Chip Viewed',
      ChipClicked: 'Pro Upgrade - Membership Chip: Click',
      PitchViewed: 'Pro Upgrade - Pitch Viewed',
      PitchJoin: 'Pro Upgrade - Pitch: Click join',
      PitchDismiss: 'Pro Upgrade - Pitch: Click continue without Pro',
    },
    // outreach-pro-gating-v2 campaign verification flow (Pro upgrade and
    // campaign verification 2.0).
    Verification: {
      IntroViewed: 'Pro Upgrade - Verification Intro Viewed',
      IntroContinue: 'Pro Upgrade - Verification Intro: Click continue',
      SubmittedViewed: 'Pro Upgrade - Verification Submitted Viewed',
    },
  },
  // Candidate questions flow. The event string is snake_case, predating the
  // 'Product Area - Action' convention; the name is kept exactly as ingested so
  // moving it into the registry stays a no-op for Amplitude and HubSpot.
  Questions: {
    Completed: 'question_complete',
    OccupationViewed: 'Questions - Occupation Viewed',
    OccupationCompleted: 'Questions - Occupation Completed',
    FunFactViewed: 'Questions - Fun Fact Viewed',
    FunFactCompleted: 'Questions - Fun Fact Completed',
    PastExperienceViewed: 'Questions - Past Experience Viewed',
    PastExperienceCompleted: 'Questions - Past Experience Completed',
  },
  // Peer-to-peer texting upsell modal, a sibling of ProUpgrade.Modal above with
  // its own event family. Every event carries `variant` (P2PModalVariant) so the
  // two upsell copies are a property filter, not separate events.
  P2PUpgrade: {
    Modal: {
      Shown: 'P2P Upgrade - Modal: Modal Shown',
      Exit: 'P2P Upgrade - Modal: Exit',
      ClickButton: 'P2P Upgrade - Modal: Click Button',
    },
  },
  // Shared Serve (elected office) + Win (campaign) contacts experience, both on
  // the People API. Every event carries a `context: 'win' | 'serve'` property
  // (sourced from ContactsTableProvider's isWinContext) so Win adoption of the
  // unified path is a property filter in Amplitude, not a duplicate event set.
  Contacts: {
    Viewed: 'Contacts - Contacts Viewed',
    Download: 'Contacts - Download',
    SegmentCreated: 'Contacts - Segment Created',
    SegmentDeleted: 'Contacts - Segment Deleted',
    SegmentUpdated: 'Contacts - Segment Updated',
    SegmentViewed: 'Contacts - Segment Viewed',
    OutreachTimelineViewed: 'Contacts - Outreach Timeline Viewed',
    // Fires once per page entry when the org has no resolvable district, so the
    // page can only offer the support handoff. 437 active campaigns are in that
    // state; this measures how many actually land here, which is what would
    // justify building self-serve remediation.
    VoterDataUnavailable: 'Contacts - Voter Data Unavailable',
    // ENG-10767: the CRM contacts assistant (crm/assistant/). Opened fires
    // once per drawer open with { context, source: 'message' | 'history' }
    // (a bar submit opens with a message; a history pick opens a past
    // conversation); MessageSent fires per user send ({ context }) — the
    // initial bar submit and every composer follow-up — so open-to-send
    // drop-off is visible.
    AssistantChatOpened: 'Contacts - Assistant Chat Opened',
    AssistantMessageSent: 'Contacts - Assistant Message Sent',
    // ENG-10767: per-stage funnel for the URL-stable create-list wizard
    // (crm/wizard/CreateListWizard.tsx) — RouteTracker page views can't see
    // its stages. Viewed fires on every stage entry (including Back
    // re-entry); Completed fires on advance (Name Completed on a successful
    // create, alongside the List Created outcome event — funnel completion
    // and outcome answer different questions). All carry { context }; the
    // conditions/name stages add { branch: 'voterFile' | 'activity' }.
    // Serve's 2-step wizard never fires the Method stage (no branch
    // chooser, ENG-10750).
    ListWizard: {
      MethodViewed: 'Contacts - List Wizard Method Viewed',
      MethodCompleted: 'Contacts - List Wizard Method Completed',
      ConditionsViewed: 'Contacts - List Wizard Conditions Viewed',
      ConditionsCompleted: 'Contacts - List Wizard Conditions Completed',
      // Serve only — the boundary step sits between conditions and name and
      // Win's wizard has no such stage, so these two never fire with
      // context 'win'. Completed carries { hasBoundary }: the step is
      // skippable, and how often it is skipped is the question the stage
      // exists to answer.
      BoundaryViewed: 'Contacts - List Wizard Boundary Viewed',
      BoundaryCompleted: 'Contacts - List Wizard Boundary Completed',
      NameViewed: 'Contacts - List Wizard Name Viewed',
      NameCompleted: 'Contacts - List Wizard Name Completed',
    },
  },
  // ENG-10688: the CRM brief specs the typeahead search events as
  // product-specific by nav surface — "Voter Data" (Win) vs "Constituent
  // Data" (Serve) — a deliberate exception to the Contacts group's
  // context-property rule above. Both fire from useContactTypeaheadSearch
  // with { resultCount }.
  ConstituentData: {
    ContactSearched: 'Constituent Data - Contact Searched',
    // ENG-10697: person-record Notes section, fires once per successful
    // create (never on failure/edit/delete). Same product-specific naming
    // exception as ContactSearched above.
    NoteAdded: 'Constituent Data - Note Added',
    // ENG-10698: fires once per record open (CRM flag on) — distinct from
    // `Contacts.Viewed` ('Contacts - Contacts Viewed'), which only fires from
    // the pre-CRM page.
    ContactViewed: 'Constituent Data - Contact Viewed',
    // ENG-10709: crm/wizard's two create branches + the list-detail download
    // seam. Same product-specific naming exception as the events above.
    // ListCreated fires once per successful voter-file-branch create with
    // { variableCount } (Win variant also carries hasParty — Serve is
    // nonpartisan and must never see it). ActivityListCreated fires once per
    // successful activity-branch create with { sourceCampaign, actionFilter }.
    // ListExported fires once per confirmed-successful download with
    // { listSize }.
    ListCreated: 'Constituent Data - List Created',
    ActivityListCreated: 'Constituent Data - Activity List Created',
    ListExported: 'Constituent Data - List Exported',
    // The boundary saved onto an existing list from the map on its detail
    // sheet. `{ listId, cleared }` — clearing a boundary is the same write
    // and is worth telling apart from setting one. Serve-only surface (the
    // map itself is), so there is no VoterData variant, same as
    // ContactStatusChanged below in the other direction.
    ListBoundarySaved: 'Constituent Data - List Boundary Saved',
    // The person-record follow-up toggle. Fires once per confirmed-successful
    // change with { from, to } — never on a failed PATCH. Serve-only
    // surface, the mirror of VoterData.ContactStatusChanged below.
    FollowUpChanged: 'Constituent Data - Follow Up Changed',
    // The closed-campaign follow-up block's two actions. Fires once per
    // successful list save with { action: 'call' | 'save', outstanding },
    // never on a failed save. Answers whether officials actually work the
    // follow-ups a campaign produces, or only read the count.
    FollowUpListCreated: 'Constituent Data - Follow Up List Created',
  },
  VoterData: {
    ContactSearched: 'Voter Data - Contact Searched',
    NoteAdded: 'Voter Data - Note Added',
    ContactViewed: 'Voter Data - Contact Viewed',
    // ENG-10709: see the ConstituentData variants above for the full seam
    // description — Win-only difference is ListCreated's hasParty property.
    ListCreated: 'Voter Data - List Created',
    ActivityListCreated: 'Voter Data - Activity List Created',
    ListExported: 'Voter Data - List Exported',
    // ENG-10767: entry point of the CRM list → outreach funnel. Fires on
    // every "Send outreach" click in the CRM with
    // { surface: 'listCard' | 'listDetail' | 'universeRow' } plus { listId }
    // for the two saved-list surfaces (the universe row links bare). This is
    // the funnel's entry only: the v2 outreach flows emit no audienceSource
    // counterpart, so a click cannot currently be joined to the campaign it
    // produced. Win-only by construction (ENG-10749 hides the button for
    // Serve), so there is no ConstituentData variant.
    SendOutreachClicked: 'Voter Data - Send Outreach Clicked',
    // ENG-10836: the person-record status row (Voter Likelihood / Support
    // Status dropdowns). Fires once per confirmed-successful change with
    // { field, from, to } — never on a failed PATCH. Win-only surface (Opt In
    // Status is read-only, no event), so there is no ConstituentData variant.
    ContactStatusChanged: 'Voter Data - Contact Status Changed',
  },
  Profile: {
    CampaignDetails: {
      ClickSave: 'Profile - Campaign Details: Click Save',
    },
    OfficeDetails: {
      ClickEdit: 'Profile - Office Details: Click Edit',
      ClickSave: 'Profile - Office Details: Click Save',
    },
    RunningAgainst: {
      ClickAddNew: 'Profile - Running Against: Click Add New',
      SubmitAddNew: 'Profile - Running Against: Submit Add New',
      CancelAddNew: 'Profile - Running Against: Cancel Add New',
      ClickEdit: 'Profile - Running Against: Click Edit',
      SubmitEdit: 'Profile - Running Against: Submit Edit',
      CancelEdit: 'Profile - Running Against: Cancel Edit',
      ClickDelete: 'Profile - Running Against: Click Delete',
      ClickSave: 'Profile - Running Against: Click Save',
    },
    TopIssues: {
      CancelEdit: 'Profile - Top Issues: Cancel Edit',
    },
    PolicyPriorities: {
      ClickAdd: 'Profile - Policy Priorities: Click Add',
      ClickEdit: 'Profile - Policy Priorities: Click Edit',
      SubmitAdd: 'Profile - Policy Priorities: Submit Add',
      SubmitEdit: 'Profile - Policy Priorities: Submit Edit',
      CancelAdd: 'Profile - Policy Priorities: Cancel Add',
      CancelEdit: 'Profile - Policy Priorities: Cancel Edit',
      ClickDelete: 'Profile - Policy Priorities: Click Delete',
      SubmitDelete: 'Profile - Policy Priorities: Submit Delete',
      CancelDelete: 'Profile - Policy Priorities: Cancel Delete',
    },
    CandidateProfile: {
      ClickSubmit: 'Profile - Candidate Profile: Click Submit',
      SubmitSuccess: 'Pro Upgrade - Candidate Profile Submitted',
      SubmitError: 'Profile - Candidate Profile: Submit Error',
    },
  },
  Settings: {
    PersonalInfo: {
      ClickUpload: 'Settings - Personal Info: Click Upload',
    },
    Account: {
      ClickUpgrade: 'Settings - Account Settings: Click Upgrade',
      ClickManageSubscription:
        'Settings - Account Settings: Click Manage Pro Subscription',
    },
    DeleteAccount: {
      ClickDelete: 'Settings - Delete Account: Click Delete',
      SubmitDelete: 'Settings - Delete Account: Submit Delete',
      CancelDelete: 'Settings - Delete Account: Cancel Delete',
    },
    Notifications: {
      ToggleEmail: 'Settings - Notifications: Toggle Email',
    },
  },
  Outreach: {
    P2PCompliance: {
      ComplianceModalViewed: 'Voter Outreach - 10DLC Compliance Modal Viewed',
      ComplianceStarted: 'Voter Outreach - 10DLC Compliance Started',
    },
    DlcCompliance: {
      RegistrationSubmitted: 'Pro Upgrade - Filing Details Submitted',
      RegistrationSubmitError: 'Pro Upgrade - Filing Details Submit Error',
      PinVerificationCompleted:
        '10 DLC Compliance - PIN Verification Completed',
    },
    PaymentStarted: 'Voter Outreach - Payment Started',
    ViewAccessed: 'Outreach - View Accessed',
    ClickCreate: 'Outreach - Click Create',
    PhoneBanking: {
      // v2 create flow (phase 1 TDD): fires once the create call succeeds.
      ListCreated: 'Voter Outreach - Phone Banking Call List Created',
      // Fires from every entry point that links to the print/[listId]/pdf
      // route (the flow's download step, and later the call-session header
      // button) — ENG-10918.
      SheetDownloaded: 'Voter Outreach - Phone Banking Call Sheet Downloaded',
      // ENG-10921: the in-app caller page. Distinct from the legacy
      // Dashboard.VoterContact.PhoneBanking group above, which belongs to
      // the pre-native script/download surface.
      ContactViewed: 'Outreach - Phone Banking: Contact Viewed',
      CallLogged: 'Outreach - Phone Banking: Call Logged',
    },
    // The audience step's recommended-lists cards.
    // Fires once the recommendation is accepted (the saved list is created),
    // not on card selection — modified vs as-is is only knowable at that
    // point (useOutreachAudience.ts).
    RecommendedList: {
      Accepted: 'Voter Outreach - Recommended List Accepted',
      // The save that Accepted reports on can fail. Without the twin, the
      // accept count is a success count with no denominator, so a rise in
      // failures reads as a fall in interest.
      Failed: 'Voter Outreach - Recommended List Failed',
    },
    // outreach-pro-gating-v2: the saved draft a gated candidate keeps.
    // Every event carries `channel` (the gate's `GateChannel`); `Resumed`
    // also carries the `source` the resume was pressed from.
    Draft: {
      Saved: 'Outreach - Draft Saved',
      Resumed: 'Outreach - Draft Resumed',
      Deleted: 'Outreach - Draft Deleted',
    },
    // outreach-pro-gating-v2: the in-flow gate's own surfaces. Both carry
    // `channel` and `requirement`; `ExplainerCta` adds which button
    // (`cta`) was pressed, dismiss included.
    Gate: {
      BannerViewed: 'Outreach - Gate Banner Viewed',
      ExplainerViewed: 'Outreach - Gate Explainer Viewed',
      ExplainerCta: 'Outreach - Gate Explainer: Click CTA',
    },
    // Per-stage drop-off across the v2 channel wizards, fired by
    // OutreachFlowShell rather than by each flow: the stage is a property
    // (`channel`, `step`), not a separate event, matching the shared
    // 'Voter Outreach - Campaign Scheduled' terminal. StepViewed re-fires on
    // Back re-entry; StepCompleted names the step the user just left, so it
    // fires only on a forward move. The gate sub-flow and the success screen
    // are deliberately untracked here — they are not stages of this funnel.
    Flow: {
      StepViewed: 'Voter Outreach - Flow Step Viewed',
      StepCompleted: 'Voter Outreach - Flow Step Completed',
    },
    ActionClicked: 'Outreach - Action Clicked',
  },
  CandidateWebsite: {
    Started: 'Candidate Website - Started',
    Continued: 'Candidate Website - Continued',
    Unpublished: 'Candidate Website - Unpublished',
    Edited: 'Candidate Website - Edited',
    StartedDomainSelection: 'Candidate Website - Started domain selection',
    SelectedDomain: 'Candidate Website - Selected domain',
  },
  Candidacy: {
    DidYouWinModalViewed: 'Candidacy - Did You Win Modal Viewed',
    DidYouWinModalCompleted: 'Candidacy - Did You Win Modal Completed',
    CampaignCompleted: 'Candidacy - Campaign Completed',
    DebriefClicked: 'Candidacy - Debrief Clicked',
  },
  ChiefOfStaff: {
    DocumentAttached: 'Chief Of Staff - Document Attached',
    LinkSubmitted: 'Chief Of Staff - Link Submitted',
    LinkFetchFailed: 'Chief Of Staff - Link Fetch Failed',
    SourceUnreachablePromptShown:
      'Chief Of Staff - Source Unreachable Prompt Shown',
    CitationOpened: 'Chief Of Staff - Citation Opened',
    UploadGuardShown: 'Chief Of Staff - Upload Guard Shown',
    ComposeHandoffOpened: 'Chief Of Staff - Compose Handoff Opened',
  },
  BriefingAssistant: {
    ListViewed: 'Briefing Assistant - List Viewed',
    BriefingViewed: 'Briefing Assistant - Briefing Viewed',
    IssueDetailViewed: 'Briefing Assistant - Issue Detail Viewed',
    DownloadClicked: 'Briefing Assistant - Download Clicked',
    FeedbackCompleted: 'Briefing Assistant - Feedback Completed',
    FeedbackSubmissionFailed: 'Briefing Assistant - Feedback Submission Failed',
    ReadFullBriefingClicked: 'Briefing Assistant - Read Full Briefing Clicked',
    ReadAloudStarted: 'Briefing Assistant - Read Aloud Started',
    ReadAloudStopped: 'Briefing Assistant - Read Aloud Stopped',
    ReadAloudCompleted: 'Briefing Assistant - Read Aloud Completed',
    ReadAloudFailed: 'Briefing Assistant - Read Aloud Failed',
    ShareDrawerOpened: 'Briefing Assistant - Share Drawer Opened',
    ShareCompleted: 'Briefing Assistant - Share Completed',
    AttachmentClicked: 'Briefing Assistant - Attachment Clicked',
    AgendaSubmitted: 'Briefing Assistant - Agenda Submitted',
    AgendaSubmissionFailed: 'Briefing Assistant - Agenda Submission Failed',
    SourcesExpanded: 'Briefing Assistant - Sources Expanded',
    TocItemClicked: 'Briefing Assistant - TOC Item Clicked',
  },
  // Speech-to-text dictation. Shared capability used across features (briefings,
  // onboarding story steps, etc.), so the events are not namespaced to any one.
  // The firing `label` prop identifies the surface (e.g. onboarding_story_why).
  Dictation: {
    Started: 'Dictation - Started',
    Failed: 'Dictation - Failed',
  },
  // V2 onboarding flow that ends in the generated campaign plan. All new
  // events (no reuse of legacy Onboarding/Dashboard events) so V2 funnels
  // never mix with historical data. Server-side generation is tracked
  // separately under `Campaign Plan V2 -` in gp-api.
  OnboardingV2: {
    // Follow-on "new campaign context" screen (the multi-org re-election vs
    // new-office choice). Only office-holders see it; candidates skip straight
    // to welcome. The chosen path is carried as the `intent` property.
    WelcomeViewed: 'Onboarding V2 - Welcome Viewed',
    WelcomeCompleted: 'Onboarding V2 - Welcome Completed',
    BallotStatusViewed: 'Onboarding V2 - Ballot Status Viewed',
    BallotStatusCompleted: 'Onboarding V2 - Ballot Status Completed',
    PartyDesignationViewed: 'Onboarding V2 - Party Designation Viewed',
    PartyDesignationCompleted: 'Onboarding V2 - Party Designation Completed',
    PartyDesignationBlocked: 'Onboarding V2 - Party Designation Blocked',
    OfficeViewed: 'Onboarding V2 - Office Viewed',
    // The candidate gave up on the office picker and was sent to the manual
    // form. Carries the picker state at the moment they gave up (zip, search
    // text, how many offices were on screen) — none of which reaches the
    // campaign record, so this event is the only record of it. Its pair is
    // OfficeCompleted with officePath: 'manual'; a Viewed without that
    // Completed is an abandoned manual form (DATA-2525).
    ManualOfficeViewed: 'Onboarding V2 - Manual Office Viewed',
    OfficeCompleted: 'Onboarding V2 - Office Completed',
    VotesNeededViewed: 'Onboarding V2 - Votes Needed Viewed',
    VotesNeededCompleted: 'Onboarding V2 - Votes Needed Completed',
    VoterInsightsViewed: 'Onboarding V2 - Voter Insights Viewed',
    VoterInsightsCompleted: 'Onboarding V2 - Voter Insights Completed',
    PledgeViewed: 'Onboarding V2 - Pledge Viewed',
    PledgeCompleted: 'Onboarding V2 - Pledge Completed',
    PlanShared: 'Onboarding V2 - Plan Shared',
    PlanDownloaded: 'Onboarding V2 - Plan Downloaded',
    CampaignManagerClicked: 'Onboarding V2 - Campaign Manager Clicked',
    MediaRequested: 'Onboarding V2 - Media Requested',
    MediaResultsReceived: 'Onboarding V2 - Media Results Received',
    MediaDisplayed: 'Onboarding V2 - Media Displayed',
    CommunityEventsRequested: 'Onboarding V2 - Community Events Requested',
    CommunityEventsResultsReceived:
      'Onboarding V2 - Community Events Results Received',
    CommunityEventsDisplayed: 'Onboarding V2 - Community Events Displayed',
    StrategicLandscapeRequested:
      'Onboarding V2 - Strategic Landscape Requested',
    StrategicLandscapeResultsReceived:
      'Onboarding V2 - Strategic Landscape Results Received',
    StrategicLandscapeDisplayed:
      'Onboarding V2 - Strategic Landscape Displayed',
    VotesNeededCalculated: 'Onboarding V2 - Votes Needed Calculated',
    VotesNeededFailed: 'Onboarding V2 - Votes Needed Failed',
    OfficeNextClicked: 'Onboarding V2 - Office Next Clicked',
    PledgeSubmitClicked: 'Onboarding V2 - Pledge Submit Clicked',
    WhyAreYouRunningViewed: 'Onboarding V2 - Why Are You Running Viewed',
    WhyAreYouRunningCompleted: 'Onboarding V2 - Why Are You Running Completed',
    BackgroundViewed: "Onboarding V2 - What's Your Background Viewed",
    BackgroundCompleted: "Onboarding V2 - What's Your Background Completed",
    IssuesViewed: 'Onboarding V2 - What Issues Do You Want To Solve Viewed',
    IssuesCompleted:
      'Onboarding V2 - What Issues Do You Want To Solve Completed',
    SignupGoalViewed: 'Onboarding V2 - Signup Goal Viewed',
    SignupGoalCompleted: 'Onboarding V2 - Signup Goal Completed',
    OnboardingSkipped: 'Onboarding V2 - Onboarding Skipped',
  },
  CommunityIssues: {
    ListViewed: 'Community Issues - List Viewed',
    IssueDetailViewed: 'Community Issues - Issue Detail Viewed',
    PrioritizeClicked: 'Community Issues - Prioritize Clicked',
    AskAIStarted: 'Community Issues - Ask AI Started',
    RunPollClicked: 'Community Issues - Run Poll Clicked',
  },
  Ordinances: {
    ClarifyViewed: 'Ordinances - Clarify Viewed',
    ClarifyCompleted: 'Ordinances - Clarify Completed',
    AuthorityViewed: 'Ordinances - Authority Viewed',
    AuthorityCompleted: 'Ordinances - Authority Completed',
    CurrentLawViewed: 'Ordinances - Current Law Viewed',
    CurrentLawCompleted: 'Ordinances - Current Law Completed',
    HowOthersSolvedItViewed: 'Ordinances - How Others Solved It Viewed',
    HowOthersSolvedItCompleted: 'Ordinances - How Others Solved It Completed',
    DraftCreationViewed: 'Ordinances - Draft Creation Viewed',
    DraftCreationCompleted: 'Ordinances - Draft Creation Completed',
    DraftDetailsViewed: 'Ordinances - Draft Details Viewed',
    DraftDetailsDownloaded: 'Ordinances - Draft Details Downloaded',
    DraftDetailsStatusUpdated: 'Ordinances - Draft Details Status Updated',
    DraftDetailsDeleted: 'Ordinances - Draft Details Deleted',
    BugReportSubmitted: 'Ordinances - Bug Report Submitted',
    BugReportErrored: 'Ordinances - Bug Report Errored',
    NewOrdinanceCreated: 'Ordinances - New Ordinance Created',
    NewOrdinanceErrored: 'Ordinances - New Ordinance Errored',
    DraftChatOpened: 'Ordinances - Draft Chat Opened',
    DraftChatMessageSent: 'Ordinances - Draft Chat Message Sent',
  },
  // ENG-10626: the native door-knocking surface (voter map, turf cutting,
  // routed walk). Distinct from Dashboard.VoterContact.DoorKnocking above,
  // which belongs to the legacy eCanvasser/script surface — different funnel,
  // don't merge them.
  //
  // The walk is the session: Started when the walk view opens, then exactly
  // one of Completed (left having logged at least one door) or Abandoned
  // (left having logged none). RouteBuildFailed is the funnel's only real
  // failure, since building a route is the one step that calls a paid vendor.
  //
  // RouteBuildFailed has no success twin: the route is bought inside the
  // list-creation transaction, so ListCreated is that success and a second
  // event would count one press twice.
  //
  // Session Completed also fires the canonical
  // Dashboard.VoterContact.CampaignCompleted with medium 'doorKnocking' —
  // that's the event the door-knocking activation metric counts, and the
  // manual "log progress" modal already feeds it the same way.
  DoorKnocking: {
    ListCreated: 'Door Knocking - List Created',
    ListEdited: 'Door Knocking - List Edited',
    ListDeleted: 'Door Knocking - List Deleted',
    RouteBuildFailed: 'Door Knocking - Route Build Failed',
    SessionStarted: 'Door Knocking - Session Started',
    SessionCompleted: 'Door Knocking - Session Completed',
    SessionAbandoned: 'Door Knocking - Session Abandoned',
    DoorLogged: 'Door Knocking - Door Logged',
    // ADR 0007, clear direction only: the walk's door is read-only-plus-Undo
    // (DoNotKnockControl), so nothing in the product sets the flag.
    DoNotKnockCleared: 'Door Knocking - Do Not Knock Cleared',
    // ADR 0008. Both directions for the same reason, and the Set event carries
    // which reason was given: the follow-up is optional, so how often it is
    // answered at all — and how the two answers split — is the only way to tell
    // whether the question is worth asking.
    NotAVoterReasonSet: 'Door Knocking - Not A Voter Reason Set',
    NotAVoterReasonCleared: 'Door Knocking - Not A Voter Reason Cleared',
  },
  // Serve issue capture, and its own product area rather than Door Knocking's
  // or Outreach's: the same three events fire from a knock and from a call, so
  // a channel-named group would have to be written twice and the rollup
  // metric — the share of conversations that carry an issue — would have to
  // add two events together. `channel` is a property instead.
  //
  // Skipped is as load-bearing as Confirmed. Together they are the only
  // measure of whether a canvasser will answer a question about a
  // conversation they have just finished, which is the riskiest assumption in
  // the feature; a skip that fired nothing would read as capture never
  // happening.
  ConstituentFeedback: {
    IssueCaptured: 'Constituent Feedback - Issue Captured',
    IssueConfirmed: 'Constituent Feedback - Issue Confirmed',
    IssueSkipped: 'Constituent Feedback - Issue Skipped',
  },
} as const

export const getStoredSessionId = (): number => {
  return Number(cookie.get('analytics_session_id') ?? 0)
}

export const storeSessionId = (id: number): void => {
  cookie.set('analytics_session_id', String(id))
}

export const extractClids = (
  searchParams: Pick<URLSearchParams, 'entries'>,
): Record<string, string> => {
  const clids: Record<string, string> = {}

  for (const [key, value] of searchParams.entries()) {
    if ((CLID_KEYS as readonly string[]).includes(key.toLowerCase()) && value) {
      clids[key] = value
    }
  }
  return clids
}

// Raw, unhashed Meta click cookies for Segment's Facebook Conversions API
// destination (server-side CAPI has no cookie access). Do not reconstruct or
// re-timestamp `_fbc` when the cookie is already present.
export const getMetaClickIds = (): { fbc?: string; fbp?: string } => {
  const fbc = cookie.get('_fbc')
  const fbp = cookie.get('_fbp')
  return { ...(fbc ? { fbc } : {}), ...(fbp ? { fbp } : {}) }
}

interface TrackRegistrationParams {
  analytics: Promise<Analytics | null>
  userId: string
  email?: string
  signUpMethod?: string
}

export const trackRegistrationCompleted = async ({
  analytics,
  userId,
  email,
  signUpMethod = 'email',
}: TrackRegistrationParams): Promise<void> => {
  const signUpDate = new Date().toISOString()
  const metaClickIds = getMetaClickIds()
  const clids = getPersistedClids()
  const fbclid = clids.fbclid_last ?? clids.fbclid_first ?? undefined
  const attributionTraits = {
    ...metaClickIds,
    ...(fbclid ? { fbclid } : {}),
  }

  try {
    const analyticsInstance = await analytics
    if (analyticsInstance && typeof analyticsInstance.identify === 'function') {
      if (typeof analyticsInstance.ready === 'function') {
        await analyticsInstance.ready()
      }
      const hutk = cookie.get('hubspotutk')
      await analyticsInstance.identify(userId, {
        signUpDate,
        signUpMethod,
        ...(email ? { email } : {}),
        ...(hutk ? { hutk } : {}),
        ...attributionTraits,
      })
    }
  } catch (error) {
    console.error('Error identifying user for registration:', error)
  }

  await trackEvent(EVENTS.Onboarding.RegistrationCompleted, {
    signUpDate,
    signUpMethod,
    ...attributionTraits,
  })
}

export const persistUtmsOnce = (): void => {
  if (typeof window === 'undefined' || !window.location.search) return

  const params = new URLSearchParams(window.location.search)

  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (!value) continue

    const firstKey = `${key}_first`
    const lastKey = `${key}_last`

    if (!sessionStorage.getItem(firstKey)) {
      sessionStorage.setItem(firstKey, value)
    }

    sessionStorage.setItem(lastKey, value)
  }
}

export const persistClidsOnce = (): void => {
  if (typeof window === 'undefined' || !window.location.search) return

  const params = new URLSearchParams(window.location.search)

  for (const key of CLID_KEYS) {
    const value = params.get(key)
    if (!value) continue

    const firstKey = `${key}_first`
    const lastKey = `${key}_last`

    if (!sessionStorage.getItem(firstKey)) {
      sessionStorage.setItem(firstKey, value)
    }
    sessionStorage.setItem(lastKey, value)
  }
}

export const getPersistedUtms = (): Record<string, string> => {
  if (
    typeof window === 'undefined' ||
    typeof window.sessionStorage === 'undefined'
  ) {
    return {}
  }

  const utms: Record<string, string> = {}

  try {
    for (const key of UTM_KEYS) {
      const first = window.sessionStorage.getItem(`${key}_first`)
      const last = window.sessionStorage.getItem(`${key}_last`)

      if (first) utms[`${key}_first`] = first
      if (last) utms[`${key}_last`] = last
    }
  } catch {
    return {}
  }

  return utms
}

export const getPersistedClids = (): Record<string, string | null> => {
  if (
    typeof window === 'undefined' ||
    typeof window.sessionStorage === 'undefined'
  ) {
    return {}
  }

  const clids: Record<string, string | null> = {}

  try {
    for (const key of CLID_KEYS) {
      const first = window.sessionStorage.getItem(`${key}_first`)
      const last = window.sessionStorage.getItem(`${key}_last`)

      if (first) clids[`${key}_first`] = first
      if (last) clids[`${key}_last`] = last
    }
  } catch {
    return {}
  }
  return clids
}

export const trackEvent = (
  name: string,
  properties?: Record<
    string,
    string[] | string | number | boolean | object | null | undefined
  >,
): Promise<void> => {
  try {
    const commonProperties = {
      ...getPersistedUtms(),
      ...(userEmail ? { email: userEmail } : {}),
      ...properties,
      impersonation: isImpersonating,
      actorUserId: actorUserId ?? null,
      actorRole: actorRole ?? null,
    }
    // Return the segmentTrackEvent promise so callers that need the event to
    // flush before a page unload (e.g. a redirect) can await it.
    return segmentTrackEvent(name, commonProperties)
  } catch (e) {
    console.log('error tracking analytics (Segment) event', e)
    return Promise.resolve()
  }
}

type PropertyValue = string | boolean | number | Date

export const buildTrackingAttrs = (
  name: string,
  properties?: Record<string, PropertyValue>,
): Record<string, string> => {
  if (!properties) {
    return {
      'data-fs-element': name,
    }
  }

  const attributes: Record<string, string | number | boolean> = {}
  const propSchema: Record<string, string> = {}

  Object.entries(properties).forEach(([key, initialValue]) => {
    const prefixedKey = `data-${kebabCase(key)}`
    let value: string | number | boolean = initialValue as
      | string
      | number
      | boolean
    let propType: string

    switch (typeof initialValue) {
      case 'string':
        propType = 'str'
        break
      case 'boolean':
        propType = 'bool'
        break
      case 'number':
        propType = Number.isInteger(value) ? 'int' : 'real'
        break
      case 'object':
        if (initialValue instanceof Date) {
          propType = 'date'
          value = initialValue.toISOString()
          break
        }
        return
      default:
        return
    }

    attributes[prefixedKey] = value
    propSchema[prefixedKey] = propType
  })

  return {
    'data-fs-element': name,
    'data-fs-properties-schema': JSON.stringify(propSchema),
    ...attributes,
  } as Record<string, string>
}
