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
  searchPlaceholder: string
  searchNoResults: string
  // ENG-10721 (CRM lists UI prototype parity): the district stat card and
  // lists-index section on crm/CrmContactsPage.tsx carry their own copy.
  districtTotalLabel: string
  // The census population row above districtTotalLabel on the same card.
  // Win has no census figure, hence optional — undefined there hides the row.
  districtPopulationLabel?: string
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
  // The boundary step and the list map's draw surface. Only Serve renders
  // them today, but this helper is mode-keyed and not mode-gated: a Win
  // literal saying "constituents" is exactly the drift it exists to prevent.
  boundaryStepTitle: string
  // Under the wizard step's read-only preview, where the map cannot be
  // drawn on. `boundaryStepHint` is the drawing surface's own hint and
  // still says to tap the map, which is only true once it is open.
  boundaryGatewayHint: string
  boundaryStepHint: string
  // Above the shape chips, once a boundary has more than one part.
  boundaryEditShapeHint: string
  boundaryDrawCta: string
  boundaryEditCta: string
  boundaryClearCta: string
  // `parts` is how many shapes the boundary is drawn in, because the count
  // is the whole boundary's and "this area" stops being true at two.
  boundaryCountLabel: (count: number, parts?: number) => string
  boundaryEmptyShape: string
  boundaryEmptyAudience: string
  boundaryUnmappable: (count: number) => string
  boundaryEstimateNote: string
  // crm/wizard/BranchStep.tsx's step-1 radio cards. The activity branch's
  // title never carries the voter/constituent noun, so it isn't listed here.
  wizardVoterFileBranchTitle: string
  wizardVoterFileBranchDescription: string
  wizardActivityBranchDescription: string
  // crm/assistant/CrmAssistant.tsx's conversation-drawer heading (ENG-10737).
  assistantTitle: string
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
        boundaryStepTitle: 'What area should this list cover?',
        boundaryGatewayHint:
          'Draw an area to narrow this list, or continue to keep the whole district.',
        boundaryStepHint:
          'Tap the map to place corners, or continue to keep the whole district.',
        boundaryEditShapeHint: 'Pick a shape to change its corners.',
        boundaryDrawCta: 'Draw an area',
        boundaryEditCta: 'Edit area',
        boundaryClearCta: 'Remove area',
        boundaryCountLabel: (count: number, parts = 1) =>
          `${count.toLocaleString()} voters in ${
            parts > 1 ? 'these areas' : 'this area'
          }`,
        boundaryEmptyShape:
          'No voters here. Try moving the area or making it wider.',
        boundaryEmptyAudience:
          'No voters match your filters yet. Go back and widen them.',
        boundaryUnmappable: (count: number) =>
          `${count.toLocaleString()} voters have no location on file.`,
        boundaryEstimateNote: 'This number is an estimate until you save.',
        wizardVoterFileBranchTitle:
          'Build a list using voter demographics and data',
        wizardVoterFileBranchDescription:
          'Use this option to select voters from your voter file.',
        wizardActivityBranchDescription:
          "Use this option to select voters who you've previously interacted with.",
        assistantTitle: 'Voter list assistant',
        unavailableTitle: "Voter data isn't available for this office yet",
        unavailableBody:
          "We couldn't match your office to a district in our voter file. Our team can set this up for you.",
        unavailableBodyWithOffice: (office: string) =>
          `We couldn't match "${office}" to a district in our voter file. Our team can set this up for you.`,
      }
    : {
        dataTitle: CONTACTS_DATA_TITLE.serve,
        universeTitle: 'Your Constituent Universe',
        searchPlaceholder: 'Search for any constituent contact',
        searchNoResults: 'No constituents found',
        districtTotalLabel: 'Records available',
        districtPopulationLabel: 'Total constituents in your district',
        listsSectionTitle: 'Constituent Lists',
        listsSectionSubtitle:
          'Constituent lists are segments you can create for targeted outreach',
        universeSubtitleBefore: 'Constituents in ',
        universeSubtitleAfter: ' that you represent.',
        allContactsTitle: 'All constituents',
        listDetailsTitle: 'Constituent list details',
        wizardVoterFileStepTitle: 'Build a constituent list',
        boundaryStepTitle: 'What area should this list cover?',
        boundaryGatewayHint:
          'Draw an area to narrow this list, or continue to keep the whole district.',
        boundaryStepHint:
          'Tap the map to place corners, or continue to keep the whole district.',
        boundaryEditShapeHint: 'Pick a shape to change its corners.',
        boundaryDrawCta: 'Draw an area',
        boundaryEditCta: 'Edit area',
        boundaryClearCta: 'Remove area',
        boundaryCountLabel: (count: number, parts = 1) =>
          `${count.toLocaleString()} constituents in ${
            parts > 1 ? 'these areas' : 'this area'
          }`,
        boundaryEmptyShape:
          'No constituents here. Try moving the area or making it wider.',
        boundaryEmptyAudience:
          'No constituents match your filters yet. Go back and widen them.',
        boundaryUnmappable: (count: number) =>
          `${count.toLocaleString()} constituents have no location on file.`,
        boundaryEstimateNote: 'This number is an estimate until you save.',
        wizardVoterFileBranchTitle: 'Build my list using the constituent file.',
        wizardVoterFileBranchDescription:
          'Use this option to select constituents from your constituent file.',
        wizardActivityBranchDescription:
          "Use this option to select constituents who you've previously interacted with.",
        assistantTitle: 'Constituent list assistant',
        unavailableTitle:
          "Constituent data isn't available for this office yet",
        unavailableBody:
          "We couldn't match your office to a district in our constituent file. Our team can set this up for you.",
        unavailableBodyWithOffice: (office: string) =>
          `We couldn't match "${office}" to a district in our constituent file. Our team can set this up for you.`,
      }
