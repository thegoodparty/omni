interface OutreachHistoryCopy {
  activeTitle: string
  archivedTitle: string
  activeCaption: string
  archivedCaption: string
  emptyFiltered: string
  emptyArchived: string
  emptyAllArchived: string
  emptyNone: string
  nameColumn: string
  untitled: string
  callResults: (count: number) => string
  archiveError: string
  restoreError: string
  markDone: string
  audienceSection: string
  turfsSection: string
}

const WIN_HISTORY_COPY: OutreachHistoryCopy = {
  activeTitle: 'Active campaigns',
  archivedTitle: 'Archived campaigns',
  activeCaption: "Every campaign you've sent, most recent first.",
  archivedCaption: 'Completed and cancelled campaigns from earlier cycles.',
  emptyFiltered: 'No campaigns match your filters.',
  emptyArchived: 'No archived campaigns.',
  emptyAllArchived:
    'All your campaigns are archived. Click “Archive” to view them.',
  emptyNone: 'No campaigns yet. Pick a channel above to create your first.',
  nameColumn: 'Campaign',
  untitled: 'Untitled campaign',
  callResults: (count) =>
    `${count.toLocaleString()} supporter${count === 1 ? '' : 's'}`,
  archiveError: "Couldn't archive this campaign. Please try again.",
  restoreError: "Couldn't restore this campaign. Please try again.",
  markDone: 'Mark campaign done',
  audienceSection: 'Voter list used',
  turfsSection: 'Turfs in this campaign',
}

const SERVE_HISTORY_COPY: OutreachHistoryCopy = {
  activeTitle: 'Your outreach',
  archivedTitle: 'Archived outreach',
  activeCaption: "Everything you've sent, most recent first.",
  archivedCaption: 'Completed and cancelled outreach you have archived.',
  emptyFiltered: 'Nothing matches your filters.',
  emptyArchived: 'No archived outreach.',
  emptyAllArchived:
    'All your outreach is archived. Click “Archive” to view it.',
  emptyNone: 'No outreach yet. Pick a channel above to send your first.',
  nameColumn: 'Outreach',
  untitled: 'Untitled outreach',
  callResults: (count) =>
    `${count.toLocaleString()} ${count === 1 ? 'needs' : 'need'} follow-up`,
  archiveError: "Couldn't archive this outreach. Please try again.",
  restoreError: "Couldn't restore this outreach. Please try again.",
  markDone: 'Mark outreach done',
  audienceSection: 'Constituent list used',
  turfsSection: 'Turfs in this outreach',
}

export const getOutreachHistoryCopy = (
  isServe: boolean,
): OutreachHistoryCopy => (isServe ? SERVE_HISTORY_COPY : WIN_HISTORY_COPY)
