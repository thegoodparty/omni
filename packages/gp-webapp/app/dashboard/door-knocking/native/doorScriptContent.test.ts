import { describe, expect, it } from 'vitest'
import type { CampaignIssuePosition } from 'gpApi/api-endpoints'
import type { Campaign } from 'helpers/types'
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

const campaign = (overrides: Partial<Campaign> = {}): Campaign =>
  ({
    firstName: 'Jane',
    lastName: 'Doe',
    positionName: 'City Council',
    ...overrides,
  }) as Campaign

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
    expect(buildIntro(campaign())).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
  })

  // Each clause drops out on its own rather than printing a placeholder the
  // canvasser has to read around.
  it('drops the office when there is none', () => {
    expect(buildIntro(campaign({ positionName: undefined }))).toBe(
      "Hi, I'm Jane Doe.",
    )
  })

  it('drops the name when there is none', () => {
    expect(
      buildIntro(campaign({ firstName: undefined, lastName: undefined })),
    ).toBe("Hi, I'm running for City Council.")
  })

  it('is empty without a campaign', () => {
    expect(buildIntro(null)).toBe('')
  })
})
