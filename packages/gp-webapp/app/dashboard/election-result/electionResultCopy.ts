// Every string the post-election screens show. A candidate reads them the day
// after their election, before any office exists, so they speak Win's words;
// the Pro winner's screen previews Serve, so it uses "you represent" the way
// Serve onboarding's district story does (SERVE_STORY_COPY).

export const COMMUNITY_URL = 'https://community.goodparty.org'

const DEFAULT_PLACE = 'your district'

// "About 32,000 people", never a false-precision count.
export const roundPopulation = (population: number): string =>
  new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(
    population,
  )

export interface WonPoint {
  title: string
  description: string
}

export const WON_COPY = {
  title: 'Congratulations, you won.',
  pro: {
    description: (place: string | null): string =>
      `Now it's time to prepare to serve, and serving starts with staying connected to ${place ?? DEFAULT_PLACE}.`,
    points: ({
      place,
      population,
      topIssue,
    }: {
      place: string | null
      population: number | null
      topIssue: string | null
    }): WonPoint[] => [
      {
        title: `You represent all of ${place ?? DEFAULT_PLACE}`,
        description: population
          ? `About ${roundPopulation(population)} people live there, and you speak for all of them.`
          : 'You speak for everyone who lives there.',
      },
      {
        title: 'Hear from more than the loudest voices',
        description: `A few residents from every group tell you where ${place ?? DEFAULT_PLACE} stands.`,
      },
      {
        title: 'Ask about what you ran on',
        description: topIssue
          ? `Learn where residents stand on ${topIssue} before you take office.`
          : 'Learn where residents stand on the issues you ran on before you take office.',
      },
    ],
    briefingNote:
      "Once you're sworn in, your chief of staff adds a briefing before every meeting.",
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
