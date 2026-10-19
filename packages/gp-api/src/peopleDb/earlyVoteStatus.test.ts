import { describe, expect, it } from 'vitest'
import {
  earlyVoteStatusFromMart,
  earlyVoteStatusToMart,
} from './earlyVoteStatus'

describe('earlyVoteStatusFromMart', () => {
  it('title-cases the mart buckets for the Person contract', () => {
    expect(earlyVoteStatusFromMart('Very likely')).toBe('Very Likely')
    expect(earlyVoteStatusFromMart('Likely')).toBe('Likely')
    expect(earlyVoteStatusFromMart('Unlikely')).toBe('Unlikely')
    expect(earlyVoteStatusFromMart('Very unlikely')).toBe('Very Unlikely')
  })

  it('keeps working if the mart ever writes Title Case', () => {
    expect(earlyVoteStatusFromMart('Very Likely')).toBe('Very Likely')
  })

  it('maps the Unknown sentinel, no value, and anything else to null', () => {
    expect(earlyVoteStatusFromMart('Unknown')).toBeNull()
    expect(earlyVoteStatusFromMart(null)).toBeNull()
    expect(earlyVoteStatusFromMart(undefined)).toBeNull()
    expect(earlyVoteStatusFromMart('Super')).toBeNull()
  })
})

describe('earlyVoteStatusToMart', () => {
  it('spells a product value the way the column stores it', () => {
    expect(earlyVoteStatusToMart('Very Likely')).toBe('Very likely')
    expect(earlyVoteStatusToMart('Very Unlikely')).toBe('Very unlikely')
    expect(earlyVoteStatusToMart('Likely')).toBe('Likely')
    expect(earlyVoteStatusToMart('Unknown')).toBe('Unknown')
  })

  it('passes an unrecognized value through so it matches nothing', () => {
    expect(earlyVoteStatusToMart('Super')).toBe('Super')
  })
})
