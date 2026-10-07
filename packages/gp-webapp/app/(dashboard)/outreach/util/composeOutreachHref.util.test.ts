import { describe, expect, it } from 'vitest'
import { flowSourceFromCompose } from './composeOutreachHref.util'

describe('flowSourceFromCompose', () => {
  it('reads the tracker as the campaign plan', () => {
    expect(flowSourceFromCompose('campaign_tracker')).toBe('campaign_plan')
  })

  it('passes the other compose sources through', () => {
    expect(flowSourceFromCompose('campaign_manager')).toBe('campaign_manager')
    expect(flowSourceFromCompose('voter_data')).toBe('voter_data')
  })

  it('reads a link with no source as a deep link', () => {
    expect(flowSourceFromCompose(undefined)).toBe('deep_link')
  })
})
