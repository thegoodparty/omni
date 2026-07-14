import { describe, expect, it } from 'vitest'
import {
  bucketForSlug,
  topIssuesBucketForDate,
} from './communityIssueBucketing'

describe('bucketForSlug', () => {
  it('returns values in [0, mod) for mod=7', () => {
    const slugs = [
      'org-a',
      'org-b',
      'org-c',
      'org-xyz',
      'test-slug-123',
      'another-org',
      'z',
    ]
    for (const slug of slugs) {
      const bucket = bucketForSlug(slug, 7)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(7)
    }
  })

  it('returns values in [0, mod) for mod=28', () => {
    const slugs = [
      'org-a',
      'org-b',
      'some-org',
      'council-member-2024',
      'mayor-smith',
    ]
    for (const slug of slugs) {
      const bucket = bucketForSlug(slug, 28)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(28)
    }
  })

  it('is deterministic — same slug always maps to the same bucket', () => {
    const slug = 'stable-slug-for-test'
    const first = bucketForSlug(slug, 7)
    expect(bucketForSlug(slug, 7)).toBe(first)
    expect(bucketForSlug(slug, 7)).toBe(first)
    expect(bucketForSlug(slug, 7)).toBe(first)
  })

  it('distributes 70 sample slugs across all 7 buckets', () => {
    const slugs = Array.from({ length: 70 }, (_, i) => `test-org-${i}`)
    const counts = new Array<number>(7).fill(0)
    for (const slug of slugs) {
      const bucket = bucketForSlug(slug, 7)
      counts[bucket] = (counts[bucket] ?? 0) + 1
    }
    // Each bucket should have at least 1 hit — no bucket completely empty
    for (const count of counts) {
      expect(count).toBeGreaterThan(0)
    }
  })

  it('distributes 112 sample slugs across all 28 buckets', () => {
    const slugs = Array.from({ length: 112 }, (_, i) => `test-org-${i}`)
    const counts = new Array<number>(28).fill(0)
    for (const slug of slugs) {
      const bucket = bucketForSlug(slug, 28)
      counts[bucket] = (counts[bucket] ?? 0) + 1
    }
    // Each bucket should have at least 1 hit
    for (const count of counts) {
      expect(count).toBeGreaterThan(0)
    }
  })

  it('different slugs can map to different buckets', () => {
    const bucket1 = bucketForSlug('org-alpha', 7)
    const bucket2 = bucketForSlug('org-beta', 7)
    const bucket3 = bucketForSlug('org-gamma', 7)
    // At least two of three should differ (near-zero collision probability)
    const allSame = bucket1 === bucket2 && bucket2 === bucket3
    expect(allSame).toBe(false)
  })
})

describe('topIssuesBucketForDate', () => {
  it('returns values in [0, 28)', () => {
    const dates = [
      '2026-07-01T00:00:00Z',
      '2026-07-15T00:00:00Z',
      '2026-07-31T00:00:00Z',
      '2026-12-25T00:00:00Z',
    ]
    for (const iso of dates) {
      const bucket = topIssuesBucketForDate(new Date(iso))
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(28)
    }
  })

  it('is deterministic — same date always maps to the same bucket', () => {
    const date = new Date('2026-07-13T00:00:00Z')
    const first = topIssuesBucketForDate(date)
    expect(topIssuesBucketForDate(date)).toBe(first)
    expect(topIssuesBucketForDate(new Date(date.getTime()))).toBe(first)
  })

  it('increments by 1 (mod 28) on each consecutive day, with no repeats', () => {
    const start = new Date('2026-07-13T00:00:00Z')
    const buckets = Array.from({ length: 28 }, (_, i) =>
      topIssuesBucketForDate(
        new Date(start.getTime() + i * 24 * 60 * 60 * 1000),
      ),
    )
    expect(new Set(buckets).size).toBe(28)
  })

  it('does not collapse days 29/30/31 onto the 28th’s bucket (the old bug)', () => {
    // Old behavior: Math.min(getUTCDate(), 28) - 1 mapped all four of these
    // to the same bucket (27). The fix must give each a distinct bucket.
    const julyTailDates = [28, 29, 30, 31].map(
      (day) => new Date(`2026-07-${day}T00:00:00Z`),
    )
    const buckets = julyTailDates.map(topIssuesBucketForDate)
    expect(new Set(buckets).size).toBe(4)
  })

  it('rotates smoothly across a calendar month boundary — every bucket fires exactly once in any 28-day span', () => {
    // Spans July 20 - Aug 16, crossing a 31-day month's end. If month
    // boundaries still caused a collapse or a gap, this would show up as a
    // bucket appearing 0 or 2+ times instead of exactly once each.
    const start = new Date('2026-07-20T00:00:00Z')
    const buckets = Array.from({ length: 28 }, (_, i) =>
      topIssuesBucketForDate(
        new Date(start.getTime() + i * 24 * 60 * 60 * 1000),
      ),
    )
    const counts = new Array<number>(28).fill(0)
    for (const bucket of buckets) counts[bucket] = (counts[bucket] ?? 0) + 1
    for (const count of counts) {
      expect(count).toBe(1)
    }
  })

  it('means an org hashed to bucket 27 never dispatches 4 times in one month anymore', () => {
    // A true 28-day rolling cycle inside a 31-day calendar window naturally
    // lands 1 or 2 times depending on phase (31 / 28 ≈ 1.1 cycles) — the old
    // bug was a deterministic 4 every single 31-day month, regardless of
    // phase. 1-2 is the fixed, expected range; 4 must never recur.
    const slugs = Array.from({ length: 200 }, (_, i) => `org-${i}`)
    const bucket27Org = slugs.find((slug) => bucketForSlug(slug, 28) === 27)
    expect(bucket27Org).toBeDefined()

    const julyDates = Array.from(
      { length: 31 },
      (_, i) => new Date(`2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    )
    const hitCount = julyDates.filter(
      (date) =>
        bucketForSlug(bucket27Org as string, 28) ===
        topIssuesBucketForDate(date),
    ).length
    expect(hitCount).toBeGreaterThanOrEqual(1)
    expect(hitCount).toBeLessThanOrEqual(2)
  })
})
