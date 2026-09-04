import {
  RECOMMENDED_LIST_VARIANT_VALUES,
  type RecommendedListIntent,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'

// The three propensity bands every universe is built from. `Unknown` is
// deliberately never a member of any band — 2.5% of voters with no turnout
// probability at all.
export const VOTER_STATUS_BANDS = {
  reliable: ['Super', 'Likely'],
  high: ['Super'],
  mid: ['Likely', 'Unreliable'],
  belowHigh: ['Likely', 'Unreliable', 'Unlikely'],
} as const

// Load-bearing: the mart column `hf_ideology_general` says `Liberal`, the
// product says progressive. Map at this boundary and nowhere else.
export const IDEOLOGY_COLUMN_VALUE = {
  progressive: 'Liberal',
  moderate: 'Moderate',
  conservative: 'Conservative',
} as const

interface RecommendedListRegistryEntry {
  intent: RecommendedListIntent
  order: number
  requiresIdeologyBucket: boolean
  copy: { title: string; criteriaSummary: string }
}

export const RECOMMENDED_LISTS_REGISTRY: Record<
  RecommendedListVariant,
  RecommendedListRegistryEntry
> = {
  introNeverIded: {
    intent: 'introduce',
    order: 0,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Meet voters who have not heard from you',
      criteriaSummary:
        'Moderate to high propensity voters with no recorded contact history.',
    },
  },
  persuadeAffinity: {
    intent: 'persuade',
    order: 1,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Persuadable independent-leaning voters',
      criteriaSummary:
        'Moderate to high propensity voters who lean independent.',
    },
  },
  persuadeIdeology: {
    intent: 'persuade',
    order: 2,
    requiresIdeologyBucket: true,
    copy: {
      title: 'Voters who may lean {bucket}',
      criteriaSummary:
        'Moderate to high propensity voters whose behavior suggests a ' +
        '{bucket} lean — a hypothesis worth testing with your message.',
    },
  },
  persuadeUndecided: {
    intent: 'persuade',
    order: 3,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Voters still on the fence',
      criteriaSummary:
        'Moderate to high propensity voters marked undecided from past ' +
        'outreach.',
    },
  },
  eventSupporters: {
    intent: 'event',
    order: 4,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Invite your supporters',
      criteriaSummary:
        'Voters who have told you they support you, regardless of ' +
        'turnout history.',
    },
  },
  eventAffinity: {
    intent: 'event',
    order: 5,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Invite independent-leaning voters',
      criteriaSummary:
        'High propensity voters who lean independent and are not known ' +
        'opponent supporters.',
    },
  },
  eventIdeology: {
    intent: 'event',
    order: 6,
    requiresIdeologyBucket: true,
    copy: {
      title: 'Invite voters who may lean {bucket}',
      criteriaSummary:
        'High propensity voters whose behavior suggests a {bucket} lean ' +
        'and who are not known opponent supporters — a hypothesis worth ' +
        'testing with an invite.',
    },
  },
  earlyVoteSupporters: {
    intent: 'earlyVote',
    order: 7,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Get your supporters voting early',
      criteriaSummary:
        'Voters who have told you they support you, regardless of ' +
        'turnout history.',
    },
  },
  earlyVoteAffinity: {
    intent: 'earlyVote',
    order: 8,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Encourage independent-leaning voters to vote early',
      criteriaSummary:
        'Moderate to high propensity voters who lean independent.',
    },
  },
  earlyVoteIdeology: {
    intent: 'earlyVote',
    order: 9,
    requiresIdeologyBucket: true,
    copy: {
      title: 'Encourage voters who may lean {bucket} to vote early',
      criteriaSummary:
        'Moderate to high propensity voters whose behavior suggests a ' +
        '{bucket} lean — a hypothesis worth testing with your message.',
    },
  },
  electionDaySupporters: {
    intent: 'electionDay',
    order: 10,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Chase supporters who need a reminder',
      criteriaSummary:
        'Voters who have told you they support you and do not reliably ' +
        'show up without a reminder.',
    },
  },
  electionDayAffinity: {
    intent: 'electionDay',
    order: 11,
    requiresIdeologyBucket: false,
    copy: {
      title: 'Turn out independent-leaning voters',
      criteriaSummary:
        'Moderate propensity voters who lean independent and may need a ' +
        'turnout push.',
    },
  },
  electionDayIdeology: {
    intent: 'electionDay',
    order: 12,
    requiresIdeologyBucket: true,
    copy: {
      title: 'Turn out voters who may lean {bucket}',
      criteriaSummary:
        'Moderate propensity voters whose behavior suggests a {bucket} ' +
        'lean — a hypothesis worth testing with a turnout push.',
    },
  },
}

export const variantsForIntent = (
  intent: RecommendedListIntent,
): RecommendedListVariant[] =>
  RECOMMENDED_LIST_VARIANT_VALUES.filter(
    (variant) => RECOMMENDED_LISTS_REGISTRY[variant].intent === intent,
  ).sort(
    (a, b) =>
      RECOMMENDED_LISTS_REGISTRY[a].order - RECOMMENDED_LISTS_REGISTRY[b].order,
  )

export const fillCopy = (
  variant: RecommendedListVariant,
  tokens: Record<string, string> = {},
): { title: string; criteriaSummary: string } => {
  const { title, criteriaSummary } = RECOMMENDED_LISTS_REGISTRY[variant].copy
  const fill = (text: string) =>
    text.replace(/{(\w+)}/g, (_match, key: string) => tokens[key] ?? `{${key}}`)
  return { title: fill(title), criteriaSummary: fill(criteriaSummary) }
}
