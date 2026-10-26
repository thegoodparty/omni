import { describe, expect, it } from 'vitest'
import { planTargetChanges } from './target-plan'

describe('planTargetChanges', () => {
  it('changes nothing when the target already matches', () => {
    expect(
      planTargetChanges({
        resolvedIps: ['10.0.6.77'],
        registeredTargets: [{ ip: '10.0.6.77', state: 'healthy' }],
      }),
    ).toEqual({ register: [], deregister: [] })
  })

  it('registers the first target into an empty group', () => {
    expect(
      planTargetChanges({ resolvedIps: ['10.0.6.77'], registeredTargets: [] }),
    ).toEqual({ register: ['10.0.6.77'], deregister: [] })
  })

  it('swaps the target when the writer moves to a new IP', () => {
    expect(
      planTargetChanges({
        resolvedIps: ['10.0.7.12'],
        registeredTargets: [{ ip: '10.0.6.77', state: 'unhealthy' }],
      }),
    ).toEqual({ register: ['10.0.7.12'], deregister: ['10.0.6.77'] })
  })

  it('does not deregister a target that is already draining', () => {
    expect(
      planTargetChanges({
        resolvedIps: ['10.0.7.12'],
        registeredTargets: [
          { ip: '10.0.7.12', state: 'healthy' },
          { ip: '10.0.6.77', state: 'draining' },
        ],
      }),
    ).toEqual({ register: [], deregister: [] })
  })

  it('registers again an IP that is draining when DNS points back to it', () => {
    expect(
      planTargetChanges({
        resolvedIps: ['10.0.6.77'],
        registeredTargets: [
          { ip: '10.0.7.12', state: 'healthy' },
          { ip: '10.0.6.77', state: 'draining' },
        ],
      }),
    ).toEqual({ register: ['10.0.6.77'], deregister: ['10.0.7.12'] })
  })

  it('ignores duplicate DNS answers', () => {
    expect(
      planTargetChanges({
        resolvedIps: ['10.0.6.77', '10.0.6.77'],
        registeredTargets: [],
      }),
    ).toEqual({ register: ['10.0.6.77'], deregister: [] })
  })

  it('refuses to empty the group when the name resolves to nothing', () => {
    expect(() =>
      planTargetChanges({
        resolvedIps: [],
        registeredTargets: [{ ip: '10.0.6.77', state: 'healthy' }],
      }),
    ).toThrow('resolved to no addresses')
  })
})
