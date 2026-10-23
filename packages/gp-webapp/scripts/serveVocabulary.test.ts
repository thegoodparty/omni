import { describe, expect, it } from 'vitest'
import { SERVE_ROUTE_PREFIXES } from '../app/dashboard/shared/serveRoutes'
import {
  SEEDED_ALLOWLIST,
  SERVE_ONLY_DIRS,
  SHARED_SERVE_ROUTES,
  formatViolations,
  isScannablePath,
  scanServeVocabulary,
  scanSource,
} from './serveVocabulary'

// The gate. A Serve surface that says "voters", "election", "candidate",
// "ballot", or "campaign" in the run-for-office sense fails here, which is
// what fails CI. The rule and the escape hatch: docs/product-vocabulary.md.
describe('Serve vocabulary', () => {
  it('never says a Win-only word in Serve copy', async () => {
    const violations = await scanServeVocabulary()
    expect(
      violations.length === 0 ? '' : `\n${formatViolations(violations)}\n`,
    ).toBe('')
  })

  // Being serve-GATED is not being serve-ONLY, and a route that is one and
  // treated as the other is either an unchecked Serve surface or a demand to
  // rewrite Win copy. So every gated route has to be classified, and adding a
  // Serve route fails this until it is.
  it('classifies every serve-gated route as serve-only or shared', () => {
    const unclassified = SERVE_ROUTE_PREFIXES.filter((prefix) => {
      const dir = `app${prefix}`
      return (
        !SERVE_ONLY_DIRS.some(
          (serveOnly) => dir === serveOnly || dir.startsWith(`${serveOnly}/`),
        ) && !(prefix in SHARED_SERVE_ROUTES)
      )
    })
    expect(unclassified).toEqual([])
  })

  // The hook and lint-staged hand this arbitrary paths, so the screen has to
  // hold on its own rather than by being a member of a walk's output.
  it('screens the paths it has an opinion about', () => {
    expect(isScannablePath('app/serve/onboarding/Flow.tsx')).toBe(true)
    expect(isScannablePath('app/dashboard/shared/contactsLabels.ts')).toBe(true)
    expect(isScannablePath('app/serve/Flow.test.tsx')).toBe(false)
    expect(isScannablePath('app/serve/Flow.stories.tsx')).toBe(false)
    expect(isScannablePath('app/types/globals.d.ts')).toBe(false)
    expect(isScannablePath('scripts/serveVocabulary.ts')).toBe(false)
    expect(isScannablePath('app/serve/page.md')).toBe(false)
    expect(isScannablePath('app/node_modules/x/index.ts')).toBe(false)
  })

  it('gives every allowlist entry a reason', () => {
    for (const [key, reason] of Object.entries(SEEDED_ALLOWLIST)) {
      expect(key, 'allowlist keys are <path>:<word>').toMatch(/^app\/.+:\w+$/)
      expect(reason.length, `${key} needs a real reason`).toBeGreaterThan(20)
    }
  })
})

const SERVE_FILE = 'app/dashboard/constituent-outreach/Probe.tsx'
const SHARED_FILE = 'app/dashboard/outreach/v2/Probe.tsx'

const words = (file: string, source: string): string[] =>
  scanSource(file, source).map((violation) => violation.word)

describe('scanSource', () => {
  it('flags the Win nouns in a Serve-only file', () => {
    expect(
      words(
        SERVE_FILE,
        `export const copy = {
  a: 'Reach every voter in your district',
  b: 'Before the election, tell them why',
  c: 'You are the strongest candidate here',
  d: 'Get on the ballot in 3 steps',
}`,
      ),
    ).toEqual(['voter', 'election', 'candidate', 'ballot'])
  })

  it('reads JSX text, apostrophes and all', () => {
    // A hand-rolled lexer opens a string on the apostrophe in "I'm" and then
    // swallows everything after it, which is why this reads a real AST.
    expect(
      words(
        SERVE_FILE,
        `const El = () => (
  <div>
    I'm here to reach every voter
  </div>
)`,
      ),
    ).toEqual(['voter'])
  })

  it('ignores comments', () => {
    expect(
      words(
        SERVE_FILE,
        `// Mirrors the candidate-facing grid: voters, the election, the ballot.
/* A block comment about the candidate's campaign. */
export const copy = 'Tell your constituents what changed'`,
      ),
    ).toEqual([])
  })

  it('ignores identifiers, enum values, route strings and class names', () => {
    expect(
      words(
        SERVE_FILE,
        `import { VOTER_LABELS } from './voterLabels'
export const enumValue = 'not_a_voter'
export const route = 'POST /v1/voters/voter-file'
export const path = '/dashboard/contacts/voter-file'
const El = () => <div className="voter-grid gap-2" data-testid="voter-row" />
export const keyed = { voter: 'Someone you represent' }`,
      ),
    ).toEqual([])
  })

  it('leaves a legislative vote alone', () => {
    expect(
      words(
        SERVE_FILE,
        `export const copy = {
  a: 'Your vote on the ordinance was recorded',
  b: 'Voting opens Monday at the council meeting',
  c: 'You were elected to a 4 year term',
}`,
      ),
    ).toEqual([])
  })

  describe('the two senses of campaign', () => {
    it('flags the run-for-office sense', () => {
      expect(
        words(
          SERVE_FILE,
          `export const copy = {
  a: 'Checking your campaign tone',
  b: 'Built from your campaign',
  c: 'Campaign Manager',
  d: 'Reuse campaigns from earlier cycles',
  e: 'Built from this campaign',
}`,
        ),
      ).toEqual(['campaign', 'campaign', 'campaign', 'campaign', 'campaign'])
    })

    it('allows the outreach-campaign sense', () => {
      expect(
        words(
          SERVE_FILE,
          `export const copy = {
  a: 'Campaign name',
  b: 'Outreach campaign history',
  c: 'Any phone banking campaign',
  d: 'Name your campaign',
  e: 'Your text campaign goes out Monday',
  f: 'Give your campaign a name to find it in your outreach history.',
  g: 'Create campaign',
  h: 'One-time charge for this campaign.',
}`,
        ),
      ).toEqual([])
    })

    it('reads the campaign sense across a line break in JSX text', () => {
      expect(
        words(
          SERVE_FILE,
          `const El = () => (
  <p>
    Create another phone
    banking campaign with this same list to call the rest.
  </p>
)`,
        ),
      ).toEqual([])
    })
  })

  describe('shared files', () => {
    it('leaves Win copy in a shared file alone', () => {
      expect(
        words(
          SHARED_FILE,
          `export const WIN_AUDIENCE_COPY = {
  pickerBody: 'Lists include all voters with a phone number',
  reachNoun: 'voters by phone banking',
}`,
        ),
      ).toEqual([])
    })

    it('flags a SERVE_ declaration that inherits a Win noun', () => {
      // The regression this whole check exists for: a new Win string lands,
      // the Serve override spreads over it, and nobody adds the Serve line.
      expect(
        words(
          SHARED_FILE,
          `const SERVE_AUDIENCE_COPY = {
  ...WIN_AUDIENCE_COPY,
  pickerBody: 'Lists include all voters with a phone number',
}`,
        ),
      ).toEqual(['voter'])
    })

    it('flags the outreach history strings Serve once showed', () => {
      expect(
        words(
          SHARED_FILE,
          `const SERVE_HISTORY_COPY = {
  title: 'Active campaigns',
  caption: "Every campaign you've sent, most recent first.",
  column: 'Campaign',
  results: '0 supporters',
}`,
        ),
      ).toEqual(['campaign', 'campaign', 'campaign', 'supporter'])
    })

    it('reads a capitalised single word as a label', () => {
      expect(
        words(
          SERVE_FILE,
          `const El = () => <th>Campaign</th>
export const kind = 'campaign'`,
        ),
      ).toEqual(['campaign'])
    })

    it('reads a derive-by-replace override as the Serve string it produces', () => {
      // ThinkingStream.tsx: Serve's list is Win's with one message swapped, so
      // the Win string it matches on sits inside the SERVE_ declaration. The
      // string being compared is a matcher, not copy on a screen.
      expect(
        words(
          SHARED_FILE,
          `const SERVE_THINKING_MESSAGES = THINKING_MESSAGES.map((message) =>
  message === 'Checking your campaign tone…' ? 'Checking your tone…' : message,
)`,
        ),
      ).toEqual([])
    })

    it('reads every string of a shared flow Serve opens as Serve copy', () => {
      // CreateCampaignSuccess.tsx and SmsFlow.tsx: unconditional strings in
      // a flow both products mount were nobody's copy, so they shipped to
      // elected officials unread.
      expect(
        words(
          'app/dashboard/door-knocking/native/createFlow/Probe.tsx',
          `const El = () => <h2>Your campaign is ready</h2>
export const caption = 'Lists include all voters with a mobile number.'`,
        ),
      ).toEqual(['campaign', 'voter'])
    })

    it('leaves the WIN_ and win: regions of a shared flow alone', () => {
      expect(
        words(
          'app/dashboard/outreach/v2/sms/Probe.tsx',
          `const WIN_SMS_RESUMED_LIST_GONE = 'The voter list is no longer available.'
const TITLE = {
  win: 'Your campaign is ready',
  serve: 'Your door knocking campaign is ready',
}
const LABEL = {
  win: 'Choose a voter list',
  serve: 'Choose a voter list',
}`,
        ),
      ).toEqual(['voter'])
    })

    it('flags the serve branch of a mode-keyed object', () => {
      expect(
        words(
          SHARED_FILE,
          `export const TITLES = {
  win: 'Voter Data',
  serve: 'Voter Data',
}`,
        ),
      ).toEqual(['voter'])
    })
  })

  describe('escape hatches', () => {
    it('honors an allow comment on the offending line', () => {
      expect(
        words(
          SERVE_FILE,
          `export const copy = 'Last election: 2024' // serve-vocabulary-allow: how they took office`,
        ),
      ).toEqual([])
    })

    it('honors an allow comment on the line above', () => {
      expect(
        words(
          SERVE_FILE,
          `export const copy = {
  // serve-vocabulary-allow: routes an official who is also running into Win
  a: "I'm still campaigning",
}`,
        ),
      ).toEqual([])
    })

    it('honors a file-level allow', () => {
      expect(
        words(
          SERVE_FILE,
          `// serve-vocabulary-allow-file: verbatim text of the nonpartisan pledge
export const pledge = 'I will run as an independent candidate'`,
        ),
      ).toEqual([])
    })

    it('does not let an allow comment elsewhere in the file cover everything', () => {
      expect(
        words(
          SERVE_FILE,
          `export const copy = {
  // serve-vocabulary-allow: this one is fine
  a: 'Last election: 2024',
  b: 'Reach every voter in your district',
}`,
        ),
      ).toEqual(['voter'])
    })
  })
})

describe('the civic panel name', () => {
  it('flags every old name for the panel, in any file', () => {
    expect(
      words(
        SHARED_FILE,
        `export const copy = {
  a: "Build your citizens' panel",
  b: 'Do they want to join your citizens’ panel?',
  c: "Who is on your citizen's panel",
  d: 'On Your Citizens Panel',
  e: 'Your civics panel is growing',
  f: 'Your constituent panel is growing',
}`,
      ),
    ).toEqual([
      'citizens panel',
      'citizens panel',
      'citizens panel',
      'citizens panel',
      'civics panel',
      'constituent panel',
    ])
  })

  it('reads JSX text with its entities', () => {
    expect(
      words(
        SHARED_FILE,
        `export const Row = () => <span>On your citizens&apos; panel</span>`,
      ),
    ).toEqual(['citizens panel'])
  })

  it('passes the civic panel and the identifiers that keep the old name', () => {
    expect(
      words(
        SHARED_FILE,
        `import { useServeCitizenPanelsFlag } from './serveCitizenPanelsFlag'
// The citizens' panel, in a comment, is not copy.
export const copy = {
  title: 'Your civic panel',
  label: 'Civic panel',
  href: '/dashboard/contacts/citizens-panel',
  flag: 'serve-citizen-panels',
}`,
      ),
    ).toEqual([])
  })
})
