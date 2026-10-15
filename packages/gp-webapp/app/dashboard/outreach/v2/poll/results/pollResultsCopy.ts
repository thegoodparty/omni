import { POLL_MIN_RESPONSES } from '@goodparty_org/contracts'

// Every string the poll results page owns is Serve copy. SERVE_* so the
// vocabulary check reads it as a Serve region (docs/product-vocabulary.md).

export const SERVE_POLL_RESULTS_COPY = {
  back: 'Polls',
  untitled: 'Your poll',
  loading: 'Loading your poll',
  loadFailed: "We couldn't load this poll. Try again.",
  messageTitle: 'Your message',
  review: {
    title: 'In review',
    body: (when: string | null) =>
      when
        ? `We'll review it within 2 business days. Once it's approved, it goes out on ${when}.`
        : "We'll review it within 2 business days.",
  },
  scheduled: {
    title: 'Scheduled',
    body: (when: string | null) =>
      when
        ? `This poll goes out on ${when}.`
        : 'This poll has not gone out yet.',
  },
  inProgress: {
    title: 'In progress',
    body: 'Responses are coming in. This page updates as they do.',
  },
  closed: {
    denied: "This poll wasn't approved to send.",
    canceled: 'This poll was canceled.',
    failed: "This poll couldn't be sent.",
  },
  stats: {
    sent: 'Sent',
    responses: 'Responses',
    responseRate: 'Response rate',
    optOutRate: 'Opted out',
  },
  notEnough: {
    title: 'Not enough responses yet',
    body: `We need at least ${POLL_MIN_RESPONSES} responses before we can group them into themes.`,
  },
  confidenceHigh: {
    title: 'Poll confidence: high',
    body: 'You can act on these results with confidence.',
  },
  confidenceLow: {
    title: 'Poll confidence: low',
    body: 'More responses would make these results more reliable.',
  },
  gather: 'Gather more feedback',
  analyzing: {
    title: 'Grouping your responses',
    body: 'Themes appear here as soon as they are ready.',
  },
  analysisFailed: "We couldn't group your responses into themes yet.",
  themesTitle: 'Top themes',
  mentions: (n: number) => `${n.toLocaleString()} mention${n === 1 ? '' : 's'}`,
  newChip: (n: number) => `${n.toLocaleString()} new`,
  viewResponses: 'View responses',
  nonClustered: {
    title: 'Other responses',
    body: "Responses that didn't fit a theme.",
    count: (n: number) => `${n.toLocaleString()} response${n === 1 ? '' : 's'}`,
  },
  allResponses: 'All responses',
  expansionsTitle: 'More feedback requests',
  expansionRow: (count: number) =>
    `${count.toLocaleString()} more constituents`,
  expansionStatus: {
    pending_payment: 'Waiting for payment',
    pending: 'In review',
    approved: 'Approved',
    paid: 'Scheduled',
    in_progress: 'Sending',
    completed: 'Done',
    denied: 'Not approved',
    canceled: 'Canceled',
    failed: "Couldn't send",
  } as Record<string, string>,
  expansionStatusFallback: 'In review',
}

export const SERVE_POLL_READER_COPY = {
  back: 'Top themes',
  responsesTitle: 'Responses',
  tabs: { all: 'All', unread: 'Unread', favorited: 'Favorited' },
  tabsLabel: 'Filter responses',
  empty: {
    all: 'No responses yet. They appear here as constituents reply.',
    unread: "You've read every response.",
    favorited: 'Tap the heart on a response to keep it here.',
  },
  loading: 'Loading responses',
  failed: "We couldn't load the responses. Try again.",
  anonymous: 'Constituent',
  optedOut: 'Opted out',
  unread: 'Unread',
  favorite: (name: string) => `Favorite the response from ${name}`,
  unfavorite: (name: string) =>
    `Remove the favorite on the response from ${name}`,
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  received: 'Received',
  contactStatus: 'Status',
  noStatus: 'No status yet',
  openRecord: 'Open their record',
  loadMore: 'Load more',
  loadingMore: 'Loading',
  showingOf: (shown: number, total: number) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`,
}
