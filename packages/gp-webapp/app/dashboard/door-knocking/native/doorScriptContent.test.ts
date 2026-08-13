import { describe, expect, it } from 'vitest'
import type { CampaignIssuePosition } from 'gpApi/api-endpoints'
import type { Campaign, User } from 'helpers/types'
import { buildIntro, buildScriptIssues } from './doorScriptContent'

const position = (
  overrides: Partial<CampaignIssuePosition> = {},
): CampaignIssuePosition => ({
  id: 1,
  description: 'Fund the shelter on Third.',
  order: 0,
  topIssue: { id: 5, name: 'Housing' },
  position: { id: 9, name: 'Expand affordable housing' },
  ...overrides,
})

// Shaped like the real payloads: `GET /v1/campaigns/mine` carries the office
// but no name columns, and the name only ever comes from the user.
const campaign = (overrides: Partial<Campaign> = {}): Campaign =>
  ({
    positionName: 'City Council',
    ...overrides,
  }) as Campaign

const user = (overrides: Partial<User> = {}): User =>
  ({
    firstName: 'Jane',
    lastName: 'Doe',
    ...overrides,
  }) as User

describe('buildScriptIssues', () => {
  it('prefers the candidate\u2019s own wording over the catalog stance', () => {
    expect(buildScriptIssues([position()], [])).toEqual([
      { title: 'Housing', body: 'Fund the shelter on Third.' },
    ])
  })

  // The catalog stance is a full sentence, so it is worth saying when the
  // candidate picked an issue but never wrote their own line.
  it('falls back to the catalog stance when there is no description', () => {
    expect(buildScriptIssues([position({ description: null })], [])).toEqual([
      { title: 'Housing', body: 'Expand affordable housing' },
    ])
  })

  // A heading with nothing under it is not a talking point.
  it('drops an issue with no stance at all', () => {
    expect(
      buildScriptIssues([position({ description: '  ', position: null })], []),
    ).toEqual([])
  })

  // The issues editor writes curated issues to campaign_position and bespoke
  // ones to details.customIssues, so a script has to read both.
  it('includes custom issues after the curated ones', () => {
    const issues = buildScriptIssues(
      [position()],
      [{ title: 'Transit', position: 'Restore the crosstown bus.' }],
    )

    expect(issues.map((issue) => issue.title)).toEqual(['Housing', 'Transit'])
  })

  it('honors order, putting unordered rows last', () => {
    const issues = buildScriptIssues(
      [
        position({ id: 1, order: null, topIssue: { id: 1, name: 'Later' } }),
        position({ id: 2, order: 2, topIssue: { id: 2, name: 'Second' } }),
        position({ id: 3, order: 1, topIssue: { id: 3, name: 'First' } }),
      ],
      [],
    )

    expect(issues.map((issue) => issue.title)).toEqual([
      'First',
      'Second',
      'Later',
    ])
  })

  // Re-entering a curated issue as a custom one is easy to do, and saying it
  // twice at the door reads as a glitch.
  it('says an issue once when it exists in both stores', () => {
    const issues = buildScriptIssues(
      [position()],
      [{ title: 'housing', position: 'Something else about housing.' }],
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.body).toBe('Fund the shelter on Third.')
  })

  // Nothing in campaign_position makes topIssueId unique per campaign, so a
  // candidate can hold two stances under one top issue. They share a heading
  // but they are two talking points, and the later one used to vanish.
  it('keeps both stances that hang off the same top issue', () => {
    const issues = buildScriptIssues(
      [
        position({
          id: 1,
          order: 0,
          description: 'Fund the shelter on Third.',
        }),
        position({
          id: 2,
          order: 1,
          description: 'Upzone the transit corridor.',
        }),
      ],
      [],
    )

    expect(issues).toEqual([
      { title: 'Housing', body: 'Fund the shelter on Third.' },
      { title: 'Housing', body: 'Upzone the transit corridor.' },
    ])
  })

  it('collapses whitespace so a pasted stance reads as one line', () => {
    const issues = buildScriptIssues(
      [position({ description: 'Fund   the\n  shelter.' })],
      [],
    )

    expect(issues[0]?.body).toBe('Fund the shelter.')
  })

  it('is empty when the candidate has written nothing', () => {
    expect(buildScriptIssues(undefined, undefined)).toEqual([])
  })
})

describe('buildIntro', () => {
  it('names the candidate and the office', () => {
    expect(buildIntro(user(), campaign())).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
  })

  // The campaign payload has no name columns at all, so a name read off it
  // would leave every real candidate anonymous at the door.
  it('takes the name from the user, not the campaign', () => {
    expect(
      buildIntro(
        null,
        campaign({ firstName: 'Jane', lastName: 'Doe' } as Partial<Campaign>),
      ),
    ).toBe("Hi, I'm running for City Council.")
  })

  it('falls back to the display name when the parts are missing', () => {
    expect(
      buildIntro(
        user({ firstName: undefined, lastName: undefined, name: 'Jane Doe' }),
        campaign(),
      ),
    ).toBe("Hi, I'm Jane Doe, running for City Council.")
  })

  // Each clause drops out on its own rather than printing a placeholder the
  // canvasser has to read around.
  it('drops the office when there is none', () => {
    expect(buildIntro(user(), campaign({ positionName: undefined }))).toBe(
      "Hi, I'm Jane Doe.",
    )
  })

  it('drops the name when there is none', () => {
    expect(
      buildIntro(
        user({ firstName: undefined, lastName: undefined }),
        campaign(),
      ),
    ).toBe("Hi, I'm running for City Council.")
  })

  it('is empty without a campaign', () => {
    expect(buildIntro(null, null)).toBe('')
  })
})
