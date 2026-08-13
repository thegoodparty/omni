// Win and Serve share the Contacts experience but must read with different
// nouns: Win never says "constituent" (ENG-10448). Keep the menu, mobile
// title, page heading, and stat labels in one place so they can't drift apart.
export const CONTACTS_DATA_TITLE = {
  win: 'Voter Data',
  serve: 'Constituent Data',
} as const

// ENG-10746: the Win voter-universe card carries two extra rows sourced from
// campaign.raceTargetMetrics. They render only in Win mode (Serve keeps the
// single constituents row), so they live outside the mode-keyed shape below.
export const WIN_UNIVERSE_STAT_LABELS = {
  projectedTurnout: 'Projected turnout',
  votersNeededToWin: 'Voters needed to win',
} as const

export interface ContactsLabels {
  dataTitle: string
  universeTitle: string
  subheading: string
  totalLabel: string
  percentLabel: string
  searchPlaceholder: string
  searchNoResults: string
  // ENG-10721 (CRM lists UI prototype parity): the district stat card and
  // lists-index section on crm/CrmContactsPage.tsx carry their own copy,
  // distinct from the generic subheading/totalLabel above.
  districtTotalLabel: string
  listsSectionTitle: string
  listsSectionSubtitle: string
  // ENG-10725 (Lovable pixel parity): the sentence under the universe h1,
  // split around the bolded location span the page interpolates, and the
  // "All voters"/"All constituents" pseudo-row at the top of the lists index.
  universeSubtitleBefore: string
  universeSubtitleAfter: string
  allContactsTitle: string
  // crm/lists/ListDetailSheet.tsx's content heading above the filter summary.
  listDetailsTitle: string
  // crm/wizard/CreateListWizard.tsx's step-2 voter-file-branch title.
  wizardVoterFileStepTitle: string
  // crm/wizard/BranchStep.tsx's step-1 radio cards. The activity branch's
  // title never carries the voter/constituent noun, so it isn't listed here.
  wizardVoterFileBranchTitle: string
  wizardVoterFileBranchDescription: string
  wizardActivityBranchDescription: string
  // crm/assistant/CrmAssistant.tsx's conversation-drawer heading (ENG-10737).
  assistantTitle: string
  // [[...attr]]/components/segments/FiltersSheet.tsx overrides the
  // filters.config.ts "Voter Demographics" section title for Serve — that
  // config file stays untouched since the legacy flag-off page renders it
  // byte-identically.
  demographicsSectionTitle: string
  // crm/VoterDataUnavailableState.tsx — shown when the org has no resolvable
  // district, so there is no voter file to show at all.
  unavailableTitle: string
  unavailableBody: string
  unavailableBodyWithOffice: (office: string) => string
}

export const getContactsLabels = (isWin: boolean): ContactsLabels =>
  isWin
    ? {
        dataTitle: CONTACTS_DATA_TITLE.win,
        universeTitle: 'Your Voter Universe',
        subheading: 'Manage and filter on your voter list',
        totalLabel: 'Total Voters',
        percentLabel: '% of Voters',
        searchPlaceholder: 'Search for any voter contact',
        searchNoResults: 'No voters found',
        districtTotalLabel: 'Voters in your district',
        listsSectionTitle: 'Voter Lists',
        listsSectionSubtitle:
          'Voter lists are segments you can create for targeted outreach',
        universeSubtitleBefore: 'Find voters in ',
        universeSubtitleAfter: ' likely to move your race and then reach them.',
        allContactsTitle: 'All voters',
        listDetailsTitle: 'Voter list details',
        wizardVoterFileStepTitle: 'Build a voter list',
        wizardVoterFileBranchTitle:
          'Build a list using voter demographics and data',
        wizardVoterFileBranchDescription:
          'Use this option to select voters from your voter file.',
        wizardActivityBranchDescription:
          "Use this option to select voters who you've previously interacted with.",
        assistantTitle: 'Voter list assistant',
        demographicsSectionTitle: 'Voter Demographics',
        unavailableTitle: "Voter data isn't available for this office yet",
        unavailableBody:
          "We couldn't match your office to a district in our voter file. Our team can set this up for you.",
        unavailableBodyWithOffice: (office: string) =>
          `We couldn't match "${office}" to a district in our voter file. Our team can set this up for you.`,
      }
    : {
        dataTitle: CONTACTS_DATA_TITLE.serve,
        universeTitle: 'Your Constituent Universe',
        subheading: 'Manage and filter on your constituent list',
        totalLabel: 'Total Constituents',
        percentLabel: '% of Constituents',
        searchPlaceholder: 'Search for any constituent contact',
        searchNoResults: 'No constituents found',
        districtTotalLabel: 'Total constituents in your district',
        listsSectionTitle: 'Constituent Lists',
        listsSectionSubtitle:
          'Constituent lists are segments you can create for targeted outreach',
        universeSubtitleBefore: 'Constituents in ',
        universeSubtitleAfter: ' that you represent.',
        allContactsTitle: 'All constituents',
        listDetailsTitle: 'Constituent list details',
        wizardVoterFileStepTitle: 'Build a constituent list',
        wizardVoterFileBranchTitle: 'Build my list using the constituent file.',
        wizardVoterFileBranchDescription:
          'Use this option to select constituents from your constituent file.',
        wizardActivityBranchDescription:
          "Use this option to select constituents who you've previously interacted with.",
        assistantTitle: 'Constituent list assistant',
        demographicsSectionTitle: 'Constituent Demographics',
        unavailableTitle:
          "Constituent data isn't available for this office yet",
        unavailableBody:
          "We couldn't match your office to a district in our constituent file. Our team can set this up for you.",
        unavailableBodyWithOffice: (office: string) =>
          `We couldn't match "${office}" to a district in our constituent file. Our team can set this up for you.`,
      }
