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
      ClickVoterData: 'Navigation - Dashboard: Click Voter Data',
      ClickDoorKnocking: 'Navigation - Dashboard: Click Door Knocking',
      ClickContentBuilder: 'Navigation - Dashboard: Click Content Builder',
      ClickMyProfile: 'Navigation - Dashboard: Click My Profile',
      ClickCampaignTeam: 'Navigation - Dashboard: Click Campaign Team',
      ClickCommunity: 'Navigation - Dashboard: Click Community',
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
    OutreachTimelineViewed: 'Contacts - Outreach Timeline Viewed',
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
    // for the two saved-list surfaces (the universe row links bare). Joins to
    // the outreach wizard's audienceSource: 'deepLink' property on the
    // audience-step Next and Voter Outreach - Campaign Completed events.
    // Win-only by construction (ENG-10749 hides the button for Serve), so
    // there is no ConstituentData variant.
    SendOutreachClicked: 'Voter Data - Send Outreach Clicked',
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
