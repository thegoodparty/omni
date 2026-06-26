import { describe, expect, it } from 'vitest'
import { validateCommunityIssuesArtifact } from './communityIssueArtifact.validation'

const validSource = {
  id: 'src-1',
  name: 'Local Gazette',
  retrieved_at: '2026-01-01T00:00:00Z',
  retrieved_text_or_snapshot: 'some text',
  source_type: 'news' as const,
}

const makeIssue = (overrides: Record<string, unknown> = {}) => ({
  category: 'public_safety',
  rank: 1,
  priority: 'high',
  title: 'Crime rates',
  summary: 'Rising crime in downtown area.',
  existing_issue_id: undefined,
  detail: {
    sources: [validSource],
    overview: { source_ids: ['src-1'], summary: 'Overview text.' },
  },
  ...overrides,
})

const validArtifact = {
  schema_version: 1,
  list: 'top_community',
  organization_slug: 'test-org',
  generated_for_run_id: 'run-abc',
  data_quality: 'ok',
  issues: [makeIssue()],
}

describe('validateCommunityIssuesArtifact', () => {
  it('accepts a well-formed artifact with no drops', () => {
    const res = validateCommunityIssuesArtifact(validArtifact)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(1)
      expect(res.dropped).toHaveLength(0)
    }
  })

  it('accepts advocacy_org as a source_type', () => {
    const issue = makeIssue({
      detail: {
        sources: [{ ...validSource, source_type: 'advocacy_org' }],
        overview: { source_ids: ['src-1'], summary: 'Overview text.' },
      },
    })
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [issue],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.artifact.issues).toHaveLength(1)
  })

  it('drops an issue with an unknown category but keeps the artifact', () => {
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [makeIssue({ category: 'bogus_category' })],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(0)
      expect(res.dropped).toHaveLength(1)
      expect(res.dropped[0].reason).toMatch(/category/i)
    }
  })

  it('keeps the valid issues and drops only the invalid ones', () => {
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [
        makeIssue({ title: 'Good one' }),
        makeIssue({ category: 'bogus_category', title: 'Bad one' }),
        makeIssue({ title: 'Another good one' }),
      ],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(2)
      expect(res.artifact.issues.map((i) => i.title)).toEqual([
        'Good one',
        'Another good one',
      ])
      expect(res.dropped).toEqual([{ index: 1, reason: expect.any(String) }])
    }
  })

  it('rejects the whole artifact when there are more than 10 issues', () => {
    const issues = Array.from({ length: 11 }, (_, i) =>
      makeIssue({ rank: i + 1, title: `Issue ${i + 1}` }),
    )
    const res = validateCommunityIssuesArtifact({ ...validArtifact, issues })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/10/i)
  })

  it('rejects the whole artifact when the envelope is invalid', () => {
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      list: 'not_a_real_list',
    })
    expect(res.ok).toBe(false)
  })

  it('drops an issue with a dangling source_id in overview.source_ids', () => {
    const issue = makeIssue({
      detail: {
        sources: [validSource],
        overview: { source_ids: ['DOES-NOT-EXIST'], summary: 'bad ref' },
      },
    })
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [issue],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(0)
      expect(res.dropped[0].reason).toMatch(/source/i)
    }
  })

  it('drops an issue with a dangling source_id in a quote item', () => {
    const issue = makeIssue({
      detail: {
        sources: [validSource],
        overview: { source_ids: ['src-1'], summary: 'ok' },
        quotes: {
          items: [{ source_id: 'MISSING', text: 'some quote' }],
        },
      },
    })
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [issue],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(0)
      expect(res.dropped[0].reason).toMatch(/source/i)
    }
  })

  it('drops an issue missing overview in detail', () => {
    const issue = makeIssue({
      detail: {
        sources: [validSource],
        // overview intentionally omitted
      },
    })
    const res = validateCommunityIssuesArtifact({
      ...validArtifact,
      issues: [issue],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.artifact.issues).toHaveLength(0)
      expect(res.dropped[0].reason).toMatch(/overview/i)
    }
  })
})
