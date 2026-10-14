import { describe, expect, it } from 'vitest'
import { sizePanelInvite } from './sizePanelInvite.tool'

describe('sizePanelInvite', () => {
  it('texts a random group of 3,334 in a large district', () => {
    expect(sizePanelInvite({ audience: 58_520 })).toEqual({
      targetMembers: 100,
      joinPerHundred: 3,
      sendTo: 3334,
      wholeAudience: false,
      cost: '$117',
    })
  })

  // Whole dollars quoted a paid text to a tiny district as $0.
  it('prices a tiny district to the cent, never as nothing', () => {
    const sized = sizePanelInvite({ audience: 10 })
    expect(sized).toMatchObject({ sendTo: 10, wholeAudience: true })
    expect(sized.cost).toBe('$0.35')
  })
})
