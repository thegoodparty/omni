// Every string the post-election screens show. A candidate reads them the day
// after their election, before any office exists, so they speak Win's words;
// the Pro winner's screen previews Serve, so it uses "you represent" the way
// Serve onboarding's district story does (SERVE_STORY_COPY).

import { format, isValid, parseISO } from 'date-fns'

export const COMMUNITY_URL = 'https://community.goodparty.org'

const DEFAULT_PLACE = 'your district'

// "About 32,000 people", never a false-precision count.
export const roundPopulation = (population: number): string =>
  new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(
    population,
  )

// "November 3" from the campaign's yyyy-MM-dd election date.
export const electionDayLabel = (
  electionDate: string | undefined,
): string | null => {
  if (!electionDate) return null
  const date = parseISO(electionDate)
  return isValid(date) ? format(date, 'MMMM d') : null
}

// "public safety" from the campaign's first issue, for the middle of a
// sentence. Acronyms and mixed-case words keep their capitals.
export const issueInSentence = (
  positions: { order: number | null; topIssue: { name: string } | null }[],
): string | null => {
  const first = [...positions]
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    )
    .map((row) => row.topIssue?.name.trim().replace(/\s+/g, ' '))
    .find((name) => !!name)
  if (!first) return null
  return first
    .split(' ')
    .map((word) => (/^[A-Z][a-z'’-]*$/.test(word) ? word.toLowerCase() : word))
    .join(' ')
}

export const ASK_COPY = {
  title: (office: string | null): string =>
    office ? `Did you win your race for ${office}?` : 'Did you win your race?',
  description: (electionDay: string | null): string =>
    electionDay
      ? `Your election was on ${electionDay}. Tell us how it went.`
      : 'Tell us how it went.',
  won: 'I won',
  lost: "I didn't win this time",
  notFinal: "Results aren't final yet",
}

// The question as the first card in Home's deck, in the manager's voice.
export const HOME_CARD_COPY = {
  description: (electionDay: string | null): string =>
    `${electionDay ? `Your election was on ${electionDay}. ` : ''}Tell me how it went so I can help with what's next.`,
  won: ASK_COPY.won,
  lost: "I didn't win",
  notFinal: ASK_COPY.notFinal,
}

// The campaign manager asks the same question in its chat.
export const CHAT_ASK_COPY = {
  opener: (electionDay: string | null, office: string | null): string[] => [
    `${electionDay ? `Election day was ${electionDay}.` : 'Election day has passed.'} Whatever happened, you ran a real race${office ? ` for ${office}` : ''}.`,
    'How did it go?',
  ],
  won: 'I won',
  lost: "I didn't win",
  notFinal: ASK_COPY.notFinal,
  lostReply: (
    firstName: string | null | undefined,
    place: string | null,
  ): string[] => [
    `We appreciate you for running${firstName ? `, ${firstName}` : ''}. Putting your name on the ballot takes courage. Great work.`,
    `If you want to run again, or help the officials serving ${place ?? DEFAULT_PLACE}, the GoodParty.org community is a good place to start.`,
  ],
  notFinalReply: ["Got it. I'll ask again in 3 days."],
  community: {
    label: 'Join the GoodParty.org community',
    description: "Independents who've run, are running, or serve.",
  },
  saveFailed: "We couldn't save your result. Try again.",
}

export const WON_COPY = {
  title: 'Congratulations, you won!',
  pro: {
    // The celebration's skip button; it moves on by itself after 3 seconds.
    continue: 'Continue',
    nextTitle: (place: string | null): string =>
      `Get ready to serve ${place ?? DEFAULT_PLACE}`,
    nextLine: (place: string | null): string =>
      `Serving starts with staying connected to ${place ?? DEFAULT_PLACE}.`,
    points: {
      represent: {
        title: (place: string | null): string =>
          `You'll represent all of ${place ?? DEFAULT_PLACE}`,
        description: (population: number | null): string =>
          population
            ? `About ${roundPopulation(population)} people live there, and you'll speak for all of them.`
            : "You'll speak for everyone who lives there.",
      },
      hear: {
        title: 'Hear from more than the loudest voices',
        description: (place: string | null): string =>
          `A few residents from every group tell you where ${place ?? DEFAULT_PLACE} stands.`,
      },
      ask: {
        title: 'Ask about what you ran on',
        description: (issue: string | null): string =>
          `Learn where residents stand on ${issue ?? 'the issues you ran on'} before you take office.`,
      },
    },
    footnote:
      "Once you're sworn in, your chief of staff adds a briefing before every meeting.",
    // The video's own lines are its text alternative, so they keep the
    // video's words (it names the civic panel; the page around it does not).
    video: {
      label: 'Who gets the mic, a 1 minute video',
      textAlternative:
        'What the video says: You represent every resident in the district. Speakers at public comment skew older, a median age of 61 against 50 for their neighbors. And they don’t reflect the whole community. Residents who reflect the whole district. Your civic panel is your community pulse.',
    },
    start: 'Start preparing to serve',
  },
  withoutPro: {
    description: 'All your work paid off. Good luck when you take office.',
    communityDescription: 'Connect with independents who are serving now.',
  },
}

export const LOST_COPY = {
  title: (firstName: string | null | undefined): string =>
    firstName ? `Thank you for running, ${firstName}` : 'Thank you for running',
  description:
    'Putting your name on the ballot takes courage, and you did it. Great work.',
  communityDescription: (place: string | null): string =>
    `Learn how to run again, or how to support the officials serving ${place ?? DEFAULT_PLACE}.`,
}

export const COMMUNITY_COPY = {
  title: 'Stay in the GoodParty.org community',
  join: 'Join the community',
}

export const BACK_TO_DASHBOARD = 'Back to dashboard'
