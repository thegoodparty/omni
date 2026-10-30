export const RESULTS_COPY = {
  pageTitle: (priority: string) => `What we heard on ${priority}`,
  caption: 'Everything your outreach on this priority has brought back so far.',
  backToPriority: 'Back to this priority',
  answered: 'People who answered',
  joinedPanel: 'Joined your civic panel',
  // Only the channels that brought answers, so a text-only priority reads
  // "25 by text" rather than two zeros.
  byChannel: (counts: {
    text: number
    phoneBanking: number
    doorKnocking: number
  }): string | null =>
    [
      counts.text > 0 && `${counts.text.toLocaleString()} by text`,
      counts.phoneBanking > 0 &&
        `${counts.phoneBanking.toLocaleString()} by phone`,
      counts.doorKnocking > 0 &&
        `${counts.doorKnocking.toLocaleString()} at the door`,
    ]
      .filter(Boolean)
      .join(' · ') || null,
  themesTitle: 'Top themes',
  themesCaption: 'Across every answer on this priority.',
  themesEmpty: 'Themes show up once at least 5 people have answered.',
  themesUpdating: 'Updating with the latest answers.',
  themesProcessing: "We're reading what people said. Themes show up here soon.",
  people: (count: number) =>
    count === 1 ? '1 person' : `${count.toLocaleString()} people`,
  themeRank: (rank: number) => `Rank ${rank}`,
  signal: {
    strong: 'Strong signal',
    fair: 'Some signal',
    thin: 'Low signal',
  },
  signalInfo: (label: string) => `What does ${label.toLowerCase()} mean?`,
  signalMeaning: (place: string | null) => {
    const where = place ?? 'your district'
    return {
      strong: `Every group in ${where} had enough people weigh in on this.`,
      fair: `At least half the groups in ${where} had enough people weigh in on this.`,
      thin: `Fewer than half the groups in ${where} had enough people weigh in on this.`,
    }
  },
  mapTitle: 'Where answers came from',
  mapCaption: 'Darker squares mean more people answered from that area.',
  mapEmpty: 'Answers show up on the map as people reply.',
  representationTitle: "Who you're hearing from",
  groupsSummary: (atShare: number, total: number) =>
    `${atShare} of ${total} groups have at least their share of answers.`,
  representationUnavailable:
    'Census figures for your district are not available yet. Email support@goodparty.org so we can look into it.',
} as const
