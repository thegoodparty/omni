import { describe, expect, it } from 'vitest'
import { buildStoryOpener } from './campaignManagerChat'

describe('buildStoryOpener', () => {
  it('introduces the manager and asks the first question when nothing is answered', () => {
    const opener = buildStoryOpener(['why', 'background', 'positions'])
    const text = opener.join('\n')
    expect(text).toContain("Hi, I'm your campaign manager")
    expect(text).toContain('First, your why')
  })

  it('welcomes back and asks the next missing question when resuming', () => {
    const opener = buildStoryOpener(['positions'])
    const text = opener.join('\n')
    expect(text).toContain('Welcome back')
    expect(text).toContain('Next, your positions')
    expect(text).not.toContain('your why')
  })

  it('leads with the first still-missing field, not always the why', () => {
    const opener = buildStoryOpener(['background', 'positions'])
    expect(opener.join('\n')).toContain('Next, your background')
  })
})
