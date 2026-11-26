export const percentOf = (count: number, total: number): number =>
  total > 0 ? Math.round((count / total) * 100) : 0

// Pinned to en-US so a count reads the same whatever the browser's locale.
export const formatResultCount = (count: number): string =>
  count.toLocaleString('en-US')

// One vocabulary for every channel's results. A stat that means the same
// thing on two channels reads the same on both, and every percentage on a
// card is out of the one total its "Based on" line names.
export const OUTREACH_RESULTS_COPY = {
  title: 'Statistics',
  sent: 'Sent',
  delivered: 'Delivered',
  notDelivered: 'Not delivered',
  responded: 'Responded',
  noResponse: 'No response',
  optedOut: 'Opted out',
  clicked: 'Clicked',
  ctr: 'CTR',
  basedOn: (total: number, one: string, other: string) =>
    `Based on ${formatResultCount(total)} ${total === 1 ? one : other}`,
  respondedCount: (count: number) => `${formatResultCount(count)} responded`,
  answeredCount: (count: number) => `${formatResultCount(count)} answered`,
  clickedCount: (count: number, sent: number) =>
    `${formatResultCount(count)} clicked (${percentOf(count, sent)}% CTR)`,
} as const
