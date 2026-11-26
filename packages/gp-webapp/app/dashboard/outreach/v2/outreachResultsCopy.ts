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
  basedOn: (total: number, one: string, other: string) =>
    `Based on ${total.toLocaleString()} ${total === 1 ? one : other}`,
  respondedCount: (count: number) => `${count.toLocaleString()} responded`,
} as const

export const percentOf = (count: number, total: number): number =>
  total > 0 ? Math.round((count / total) * 100) : 0
