import { kebabCase } from 'es-toolkit'
import { segmentTrackEvent } from './segmentHelper'
import cookie from 'js-cookie'
import type { Analytics } from '@segment/analytics-next'

let isImpersonating = false
export const setImpersonating = (value: boolean): void => {
  isImpersonating = value
}

let userEmail: string | undefined
export const setUserEmail = (value: string | undefined): void => {
  userEmail = value
}

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

const CLID_SUFFIX = 'clid'

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

  SignUp: {
    ClickLogin: 'Sign Up: Click Login',
  },
  SignIn: {
    ClickCreateAccount: 'Sign In: Click Create Account',
    ClickForgotPassword: 'Sign In: Click Forgot Password',
    LoginCompleted: 'Sign In: Login Completed',
  },
  Password: {
    PasswordResetRequested: 'Account - Password Reset Requested',
    PasswordResetCompleted: 'Account - Password Reset Completed',
    PasswordSetCompleted: 'Account - Password Set Completed',
  },
  SetPassword: {
    ClickSetPassword: 'Set Password: Click Set Password',
  },
  Onboarding: {
    RegistrationCompleted: 'Onboarding - Registration Completed',
    ClickFinishLater: 'Onboarding: Click Finish Later',
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
    PartyStep: {
      ClickSubmit: 'Onboarding - Party Step: Click Submit',
      Completed: 'Onboarding - Candidate Affiliation Completed',
    },
    PledgeStep: {
      ClickAskQuestion: 'Onboarding - Pledge Step: Click Ask a Question',
      ClickSubmit: 'Onboarding - Pledge Step: Click Submit',
      Completed: 'Onboarding - Candidate Pledge Completed',
    },
    CompleteStep: {
      ClickGoToDashboard: 'Onboarding - Complete Step: Click Go to Dashboard',
    },
    WelcomeCompleted: 'Onboarding - Welcome Completed',
    BallotStatusCompleted: 'Onboarding - Ballot Status Completed',
    KnowYourVotersCompleted: 'Onboarding - Know Your Voters Completed',
    PartySelectionCompleted: 'Onboarding - Party Selection Completed',
    OfficeSelectionCompleted: 'Onboarding - Office Selection Completed',
    PathToVictoryUpdated: 'Onboarding - Path To Victory Updated',
    PathToVictoryErrored: 'Onboarding - Path To Victory Errored',
    PathToVictoryCompleted: 'Onboarding - Path To Victory Completed',
    PledgeCompleted: 'Onboarding - Pledge Completed',
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
        ClickSettings: 'Navigation Top - Avatar Dropdown: Click Settings',
        ClickLogout: 'Navigation Top - Avatar Dropdown: Click Logout',
      },
    },
    Dashboard: {
      ClickDashboard: 'Navigation - Dashboard: Click Dashboard',
      ClickAIAssistant: 'Navigation - Dashboard: Click AI Assistant',
      ClickVoterData: 'Navigation - Dashboard: Click Voter Data',
      ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',
      ClickIssues: 'Navigation - Dashboard: Click Issues',
      ClickContentBuilder: 'Navigation - Dashboard: Click Content Builder',
      ClickMyProfile: 'Navigation - Dashboard: Click My Profile',
      ClickCampaignTeam: 'Navigation - Dashboard: Click Campaign Team',
      ClickCommunity: 'Navigation - Dashboard: Click Community',
      ClickWebsite: 'Navigation - Dashboard: Click Website',
      ClickVoterOutreach: 'Navigation - Dashboard: Click Voter Outreach',
      ClickContacts: 'Navigation - Dashboard: Click Contacts',
      ClickPolls: 'Navigation - Dashboard: Click Polls',
      ClickBriefings: 'Navigation - Dashboard: Click Briefings',
      ClickCommunityIssues: 'Navigation - Dashboard: Click Community Issues',
      ClickCampaignPlan: 'Navigation - Dashboard: Click Campaign Plan',
    },
  },

  // Multi-org dashboard switcher (ENG-10377). The follow-on funnel the
  // "run for" actions open is tracked under OnboardingV2 (intent step) and,
  // for the created/blocked outcome, server-side in gp-api.
  OrgSwitcher: {
    RunForOfficeClicked: 'Org Switcher - Run For Office Clicked',
    OrganizationSwitched: 'Org Switcher - Organization Switched',
  },

  Dashboard: {
    Viewed: 'Dashboard - Candidate Dashboard Viewed',
    CampaignPlan: {
      GenerationCompleted: 'Dashboard - Campaign Plan Generation Completed',
      Viewed: 'Dashboard - Campaign Plan Viewed',
      WeekNavigated: 'Dashboard - Campaign Plan Week Navigated',
      TaskCTAClicked: 'Dashboard - Campaign Plan Task CTA Clicked',
      TaskStatusUpdated: 'Dashboard - Campaign Task Status Updated',
      ViewModeToggled: 'Dashboard - Campaign Plan View Mode Toggled',
      VoterContactDialogViewed: 'Dashboard - Voter Contact Dialog Viewed',
      VoterContactRecorded: 'Dashboard - Voter Contact Recorded',
      MediaRequested: 'Dashboard - Campaign Plan: Media Requested',
      StrategicLandscapeRequested:
        'Dashboard - Campaign Plan: Strategic Landscape Requested',
      CommunityEventsRequested:
        'Dashboard - Campaign Plan: Community Events Requested',
      MediaResultsReceived: 'Dashboard - Campaign Plan: Media Results Received',
      MediaDisplayed: 'Dashboard - Campaign Plan: Media Displayed',
      CommunityEventsResultsReceived:
        'Dashboard - Campaign Plan: Community Events Results Received',
      CommunityEventsDisplayed:
        'Dashboard - Campaign Plan: Community Events Displayed',
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
          Submit: 'Schedule Text Campaign: Submit',
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
  Account: {
    ProSubscriptionCanceled: 'Account - Pro Subscription Canceled',
  },
  AIAssistant: {
    ClickNewChat: 'AI Assistant: Click new chat',
    ClickViewChatHistory: 'AI Assistant: Click view chat history',
    AskQuestion: 'AI Assistant: Ask a question',
    ChatHistory: {
      ClickMenu: 'AI Assistant - Chat History: Click menu',
      ClickDelete: 'AI Assistant - Chat History: Click delete',
    },
    Chat: {
      ClickThumbsUp: 'AI Assistant - Chat: Click thumbs up',
      ClickThumbsDown: 'AI Assistant - Chat: Click thumbs down',
      ClickRegenerate: 'AI Assistant - Chat: Click regenerate',
      ClickCopy: 'AI Assistant - Chat: Click copy',
    },
  },
  ProUpgrade: {
    ClickExit: 'Pro Upgrade: Click exit top nav',
    EditOffice: 'Pro Upgrade: Edit office',
    SubmitEditOffice: 'Pro Upgrade: Submit edit office',
    ConfirmOffice: 'Pro Upgrade: Confirm office',
    ExitEditOffice: 'Pro Upgrade: Exit edit office',
    Banner: {
      ClickUpgrade:
        'Pro Upgrade - Level Up Your Campaign Banner: Click upgrade',
    },
    Modal: {
      Shown: 'Pro Upgrade - Modal: Modal Shown',
      Exit: 'Pro Upgrade - Modal: Exit',
      ClickButton: 'Pro Upgrade - Modal: Click Button',
    },
    SplashPage: {
      ClickUpgrade: 'Pro Upgrade - Splash Page: Click upgrade',
      Exit: 'Pro Upgrade - Splash Page: Exit',
    },
    CommitteeCheck: {
      ClickBack: 'Pro Upgrade - Committee Check Page: Click back',
      ClickNext: 'Pro Upgrade - Committee Check Page: Click next',
      HoverNameHelp:
        'Pro Upgrade - Committee Check Page: Hover "Name of Campaign Committee" help',
      ToggleRequired:
        'Pro Upgrade - Committee Check Page: Toggle EIN requirement',
      HoverEinHelp:
        'Pro Upgrade - Committee Check Page: Hover "EIN number" help',
      ClickUpload: 'Pro Upgrade - Committee Check Page: Click Upload ',
      HoverUploadHelp:
        'Pro Upgrade - Committee Check Page: Hover "Upload" help',
    },
    ServiceAgreement: {
      ClickBack: 'Pro Upgrade - Service Agreement Page: Click back',
      ClickFinish: 'Pro Upgrade - Service Agreement Page: Click finish',
    },
    ClickGoToStripe: 'Pro Upgrade: Click Go to Stripe',
    // Agentic Pro Upgrade → 10DLC compliance funnel (ENG-10294). Kept separate
    // from the legacy Modal / SplashPage / CommitteeCheck events above, which
    // belong to the older upgrade UX. The funnel's submit/checkout-start signals
    // already exist and are reused (Profile.CandidateProfile.SubmitSuccess,
    // Outreach.DlcCompliance.RegistrationSubmitted / PinVerificationCompleted,
    // ProUpgrade.ClickGoToStripe); the "viewed" steps below were the gap.
    Compliance: {
      BannerViewed: 'Pro Upgrade - Banner Viewed',
      BannerGetPro: 'Pro Upgrade - Banner: Click Get Pro',
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
      CandidateProfileViewed: 'Pro Upgrade - Candidate Profile Viewed',
      FilingDetailsViewed: 'Pro Upgrade - Filing Details Viewed',
      PaymentViewed: 'Pro Upgrade - Payment Viewed',
      SuccessViewed: 'Pro Upgrade - Success Viewed',
      SuccessContinue: 'Pro Upgrade - Success: Click continue',
      PinEntryViewed: 'Pro Upgrade - PIN Entry Viewed',
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
    ColumnEdited: 'Contacts - Column Edited',
    OutreachTimelineViewed: 'Contacts - Outreach Timeline Viewed',
  },
  VoterData: {
    ClickNeedHelp: 'Voter Data: Click Need Help',
    NeedHelp: {
      Exit: 'Voter Data - Need Help: Exit modal',
      SelectType: 'Voter Data - Need Help: Select Voter File type',
      Submit: 'Voter Data - Need Help: Submit',
    },
    ClickCreateCustom: 'Voter Data: Click Create Custom Voter File',
    CustomFile: {
      Exit: 'Voter Data - Custom Voter File: Exit modal',
      SelectChannel: 'Voter Data - Custom Voter File: Select Channel',
      SelectPurpose: 'Voter Data - Custom Voter File: Select Purpose',
      ClickNext: 'Voter Data - Custom Voter File: Click Next',
      Audience: {
        CheckAudience:
          'Voter Data - Custom Voter File - Audience: Check Audience',
        CheckPoliticalParty:
          'Voter Data - Custom Voter File - Audience: Check Political Party',
        CheckAge: 'Voter Data - Custom Voter File - Audience: Check Age',
        CheckGender: 'Voter Data - Custom Voter File - Audience: Check Gender',
        ClickBack: 'Voter Data - Custom Voter File - Audience: Click Back',
      },
      ClickCreate: 'Voter Data - Custom Voter File: Click Create',
    },
    ClickDetail: 'Voter Data: Click Detail View',
    FileDetail: {
      ClickBack: 'Voter Data - File Detail: Click Back',
      ClickDownloadCSV: 'Voter Data - File Detail: Click Download CSV',
      ClickViewFilters: 'Voter Data - File Detail: Click View Audience Filters',
      ClickInfoIcon: 'Voter Data - File Detail: Click Custom File Info Icon',
      LearnTakeAction: {
        ClickWriteScript:
          'Voter Data - File Detail - Learn & Take Action: Click Write Script',
        ClickReadMore:
          'Voter Data - File Detail - Learn & Take Action: Click Read More',
        ClickSchedule:
          'Voter Data - File Detail - Learn & Take Action: Click Schedule',
      },
      RecommendedPartners: {
        ClickReadMore:
          'Voter Data - File Detail - Recommended Partners: Click Read More',
      },
    },
  },
  ContentBuilder: {
    ClickContinueQuestions: 'Content Builder: Click Continue Questions',
    ClickGenerate: 'Content Builder: Click Generate',
    SelectTemplate: 'Content Builder: Select Template',
    CloseAdditionalInputs: 'Content Builder: Close Additional Inputs',
    SubmitAdditionalInputs: 'Content Builder: Submit Additional Inputs',
    ClickContent: 'Content Builder: Click Content',
    Editor: {
      ClickRegenerate: 'Content Builder - Editor: Click Regenerate',
      SubmitRegenerate: 'Content Builder - Editor: Submit Regenerate',
      ClickCopy: 'Content Builder - Editor: Click Copy',
      ClickTranslate: 'Content Builder - Editor: Click Translate',
      SubmitTranslate: 'Content Builder - Editor: Submit Translate',
      OpenVersionPicker: 'Content Builder - Editor: Open Version Picker',
      SelectVersion: 'Content Builder - Editor: Select Version',
    },
    OpenKebabMenu: 'Content Builder - Editor: Open Kebab Menu',
    KebabMenu: {
      ClickRename: 'Content Builder - Editor: Click Rename',
      ClickDelete: 'Content Builder - Editor: Click Delete',
    },
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
    Why: {
      ClickSave: 'Profile - Why Section: Click Save',
    },
    WhyRunning: {
      ClickSave: 'Profile - Why Running: Click Save',
    },
    FunFact: {
      ClickSave: 'Profile - Fun Fact: Click Save',
    },
    TopIssues: {
      ClickFinish: 'Profile - Top Issues: Click Finish Entering Issues',
      ClickEdit: 'Profile - Top Issues: Click Edit',
      SubmitEdit: 'Profile - Top Issues: Submit Edit',
      CancelEdit: 'Profile - Top Issues: Cancel Edit',
      ClickDelete: 'Profile - Top Issues: Click Delete',
      SubmitDelete: 'Profile - Top Issues: Submit Delete',
      CancelDelete: 'Profile - Top Issues: Cancel Delete',
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
      ClickSave: 'Profile - Policy Priorities: Click Save',
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
      ClickSave: 'Settings - Personal Info: Click Save',
    },
    Account: {
      ClickUpgrade: 'Settings - Account Settings: Click Upgrade',
      ClickSendEmail: 'Settings - Account Settings: Click Send Email',
      ClickManageSubscription:
        'Settings - Account Settings: Click Manage Pro Subscription',
    },
    Notifications: {
      ToggleEmail: 'Settings - Notifications: Toggle Email',
    },
    Password: {
      ClickSave: 'Settings - Password: Click Save',
    },
    DeleteAccount: {
      ClickDelete: 'Settings - Delete Account: Click Delete',
      SubmitDelete: 'Settings - Delete Account: Submit Delete',
      CancelDelete: 'Settings - Delete Account: Cancel Delete',
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
    SocialMedia: {
      Complete: 'Outreach - Social Media: Complete',
    },
    DoorKnocking: {
      Complete: 'Outreach - Door Knocking: Complete',
    },
    PhoneBanking: {
      Complete: 'Outreach - Phone Banking: Complete',
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
    DictationStarted: 'Briefing Assistant - Dictation Started',
    DictationFailed: 'Briefing Assistant - Dictation Failed',
    ShareDrawerOpened: 'Briefing Assistant - Share Drawer Opened',
    ShareCompleted: 'Briefing Assistant - Share Completed',
    AttachmentClicked: 'Briefing Assistant - Attachment Clicked',
    AgendaSubmitted: 'Briefing Assistant - Agenda Submitted',
    AgendaSubmissionFailed: 'Briefing Assistant - Agenda Submission Failed',
    SourcesExpanded: 'Briefing Assistant - Sources Expanded',
    TocItemClicked: 'Briefing Assistant - TOC Item Clicked',
  },
  // V2 onboarding flow that ends in the generated campaign plan. All new
  // events (no reuse of legacy Onboarding/Dashboard events) so V2 funnels
  // never mix with historical data. Server-side generation is tracked
  // separately under `Campaign Plan V2 -` in gp-api.
  OnboardingV2: {
    // Follow-on "new campaign context" screen (the multi-org re-election vs
    // new-office choice). Only office-holders see it; candidates skip straight
    // to welcome. The chosen path is carried as the `intent` property.
    NewCampaignContextViewed: 'Onboarding V2 - New Campaign Context Viewed',
    NewCampaignContextCompleted:
      'Onboarding V2 - New Campaign Context Completed',
    WelcomeViewed: 'Onboarding V2 - Welcome Viewed',
    WelcomeCompleted: 'Onboarding V2 - Welcome Completed',
    BallotStatusViewed: 'Onboarding V2 - Ballot Status Viewed',
    BallotStatusCompleted: 'Onboarding V2 - Ballot Status Completed',
    PartyDesignationViewed: 'Onboarding V2 - Party Designation Viewed',
    PartyDesignationCompleted: 'Onboarding V2 - Party Designation Completed',
    PartyDesignationBlocked: 'Onboarding V2 - Party Designation Blocked',
    OfficeViewed: 'Onboarding V2 - Office Viewed',
    OfficeCompleted: 'Onboarding V2 - Office Completed',
    VotesNeededViewed: 'Onboarding V2 - Votes Needed Viewed',
    VotesNeededCompleted: 'Onboarding V2 - Votes Needed Completed',
    VoterInsightsViewed: 'Onboarding V2 - Voter Insights Viewed',
    VoterInsightsCompleted: 'Onboarding V2 - Voter Insights Completed',
    ResourcesViewed: 'Onboarding V2 - Resources Viewed',
    ResourcesCompleted: 'Onboarding V2 - Resources Completed',
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
  },
  CommunityIssues: {
    ListViewed: 'Community Issues - List Viewed',
    IssueDetailViewed: 'Community Issues - Issue Detail Viewed',
    PrioritizeClicked: 'Community Issues - Prioritize Clicked',
    AskAIStarted: 'Community Issues - Ask AI Started',
    RunPollClicked: 'Community Issues - Run Poll Clicked',
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
    if (key.toLowerCase().endsWith('clid')) {
      clids[key] = value
    }
  }
  return clids
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

  try {
    const analyticsInstance = await analytics
    if (analyticsInstance && typeof analyticsInstance.identify === 'function') {
      if (typeof analyticsInstance.ready === 'function') {
        await analyticsInstance.ready()
      }
      const hutk = cookie.get('hubspotutk')
      analyticsInstance.identify(userId, {
        signUpDate,
        signUpMethod,
        ...(email ? { email } : {}),
        ...(hutk ? { hutk } : {}),
      })
    }
  } catch (error) {
    console.error('Error identifying user for registration:', error)
  }

  trackEvent(EVENTS.Onboarding.RegistrationCompleted, {
    signUpDate,
    signUpMethod,
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

  for (const [key, value] of params.entries()) {
    if (!key.toLowerCase().endsWith(CLID_SUFFIX) || !value) continue

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
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (
        key &&
        (key.toLowerCase().endsWith(`${CLID_SUFFIX}_first`) ||
          key.toLowerCase().endsWith(`${CLID_SUFFIX}_last`))
      ) {
        clids[key] = window.sessionStorage.getItem(key)
      }
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
