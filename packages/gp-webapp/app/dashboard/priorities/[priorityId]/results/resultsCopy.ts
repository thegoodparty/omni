import type { RepresentationDimension } from '@goodparty_org/contracts'

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
  themesCaption: 'Across every text, call and door on this priority.',
  themesEmpty: 'Themes show up once at least 5 people have answered.',
  themesUpdating: 'Updating with the latest answers.',
  people: (count: number) =>
    count === 1 ? '1 person' : `${count.toLocaleString()} people`,
  mapTitle: 'Where answers came from',
  mapCaption: 'Darker squares mean more people answered from that area.',
  mapEmpty: 'Answers show up on the map as people reply.',
  representationTitle: "Who you're hearing from",
  representationCaption:
    'Compares the neighborhoods people answered from with your whole district.',
  representationEmpty: (minimum: number) =>
    `Hear from at least ${minimum} people to compare them with your district.`,
  representationUnavailable:
    'Census figures for your district are not available yet. Email support@goodparty.org so we can look into it.',
  overBy: (points: number) => `${points} points over`,
  underBy: (points: number) => `${points} points under`,
  even: 'About even',
  shares: (respondent: number, district: number) =>
    `${respondent}% of answers, ${district}% of your district`,
  legendOver: 'More than their share',
  legendUnder: 'Fewer than their share',
} as const

export const DIMENSION_LABELS: Record<RepresentationDimension, string> = {
  age: 'Age',
  race: 'Race and ethnicity',
  education: 'Education',
  income: 'Household income',
  housing: 'Home',
  poverty: 'Poverty',
}
