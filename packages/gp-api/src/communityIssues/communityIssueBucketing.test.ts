import { describe, expect, it } from 'vitest'
import { bucketForSlug } from './communityIssueBucketing'

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
