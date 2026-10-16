import { describe, expect, it } from 'vitest'
import { sizePanelInvite } from './sizePanelInvite.tool'

describe('sizePanelInvite', () => {
  it('texts enough of a large district to reach its goal', () => {
    expect(sizePanelInvite({ audience: 58_520 }, 240)).toEqual({
      targetMembers: 240,
      joinPerHundred: 3,
      sendTo: 8000,
      wholeAudience: false,
      cost: '$280',
    })
  })

  it('sizes to a small town goal', () => {
    expect(sizePanelInvite({ audience: 1_500 }, 230)).toMatchObject({
      targetMembers: 230,
      sendTo: 1_500,
      wholeAudience: true,
    })
  })

  // Whole dollars quoted a paid text to a tiny district as $0.
  it('prices a tiny district to the cent, never as nothing', () => {
    const sized = sizePanelInvite({ audience: 10 }, 240)
    expect(sized).toMatchObject({ sendTo: 10, wholeAudience: true })
    expect(sized.cost).toBe('$0.35')
  })
})
