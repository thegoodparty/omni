// Shared by the priority page and its results page, so "a good read" reads
// the same everywhere it shows.
export const READ_STATUS_COPY = {
  moreAnswers: (more: number) =>
    more === 1
      ? '1 more answer for a good read'
      : `${more.toLocaleString()} more answers for a good read`,
  goodRead: 'You have a good read',
  getAnswers: 'Get answers',
  seeWhatWeHeard: 'See what we heard',
  whatWeHeard: 'What we heard',
  progress: (answers: number, needed: number) =>
    `${answers.toLocaleString()} of ${needed.toLocaleString()} answers for a good read`,
  tooEarly:
    "It's too early to tell what your community thinks. We'll show what we heard once you have a good read.",
} as const

export const resultsHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}/results`

// The results page's Get answers goes back to the priority, which sends the
// agent the same hidden turn its own button does.
export const GET_ANSWERS_PARAM = 'getAnswers'

export const getAnswersHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}?${GET_ANSWERS_PARAM}=1`

export const readPercent = (answers: number, needed: number): number =>
  Math.min(100, Math.round((answers / needed) * 100))
