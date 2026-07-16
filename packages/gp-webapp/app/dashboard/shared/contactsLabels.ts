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
      }
    : {
        dataTitle: CONTACTS_DATA_TITLE.serve,
        universeTitle: 'Your Constituent Universe',
        subheading: 'Manage and filter on your constituent list',
        totalLabel: 'Total Constituents',
        percentLabel: '% of Constituents',
        searchPlaceholder: 'Search for any constituent contact',
        searchNoResults: 'No constituents found',
      }
