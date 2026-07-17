// Win and Serve share the Contacts experience but must read with different
// nouns: Win never says "constituent" (ENG-10448). Keep the menu, mobile
// title, page heading, and stat labels in one place so they can't drift apart.
export const CONTACTS_DATA_TITLE = {
  win: 'Voter Data',
  serve: 'Constituent Data',
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
  // crm/wizard/CreateListWizard.tsx's step-2 voter-file-branch title.
  wizardVoterFileStepTitle: string
  // crm/wizard/BranchStep.tsx's step-1 radio cards. The activity branch's
  // title never carries the voter/constituent noun, so it isn't listed here.
  wizardVoterFileBranchTitle: string
  wizardVoterFileBranchDescription: string
  wizardActivityBranchDescription: string
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
        districtTotalLabel: 'Total voters in your district',
        listsSectionTitle: 'Voter Lists',
        listsSectionSubtitle:
          'Voter lists are segments you can create for targeted outreach',
        wizardVoterFileStepTitle: 'Build a voter list',
        wizardVoterFileBranchTitle: 'Build my list using the voter file.',
        wizardVoterFileBranchDescription:
          'Use this option to select voters from your voter file.',
        wizardActivityBranchDescription:
          "Use this option to select voters who you've previously interacted with.",
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
        wizardVoterFileStepTitle: 'Build a constituent list',
        wizardVoterFileBranchTitle: 'Build my list using the constituent file.',
        wizardVoterFileBranchDescription:
          'Use this option to select constituents from your constituent file.',
        wizardActivityBranchDescription:
          "Use this option to select constituents who you've previously interacted with.",
      }
