import { describe, expect, it } from 'vitest'
import { AGENTS } from './agents.registry'
import { agentsOnGpApi } from '../../deploy/agentsOnGpApi'

describe('agentsOnGpApi', () => {
  // A preview is the judge's candidate arm, so an agent it leaves out runs the
  // PMF Engine on both arms and a suite for it would compare that engine with
  // itself. This is what makes the list follow the registry instead of drifting.
  it('puts every registered agent on gp-api in a preview', () => {
    expect(agentsOnGpApi('preview').split(',')).toEqual(Object.keys(AGENTS))
  })

  it('names top_community_issues in dev and leaves prod to trending_issues', () => {
    expect(agentsOnGpApi('dev')).toBe('trending_issues,top_community_issues')
    expect(agentsOnGpApi('prod')).toBe('trending_issues')
  })
})
