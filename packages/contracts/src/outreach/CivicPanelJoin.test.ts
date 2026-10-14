import { describe, expect, it } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'
import {
  PANEL_SEED_ASSUMED_JOIN_RATE,
  PANEL_SEED_SAMPLE_SIZE,
  PANEL_SEED_TARGET_MEMBERS,
} from './CivicPanelJoin'

describe('PANEL_SEED_SAMPLE_SIZE', () => {
  it('texts enough residents to reach the target at the assumed join rate', () => {
    expect(PANEL_SEED_SAMPLE_SIZE).toBe(3334)
    expect(
      PANEL_SEED_SAMPLE_SIZE * PANEL_SEED_ASSUMED_JOIN_RATE,
    ).toBeGreaterThanOrEqual(PANEL_SEED_TARGET_MEMBERS)
    expect(PANEL_SEED_SAMPLE_SIZE).toBeLessThanOrEqual(MAX_LIST_SAMPLE_SIZE)
  })
})
