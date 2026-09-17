import { describe, expect, it } from 'vitest'
import { listDetailsFooterMode } from './footerMode'

// The canvas's footer is a closed set of four modes. The point of a table
// rather than a test per branch is that the set stays closed: a fifth mode
// added for one channel's one-off has nowhere to land here.
describe('listDetailsFooterMode', () => {
  it('gives a self-serve campaign the mode for its lifecycle', () => {
    expect(listDetailsFooterMode('scheduled', true)).toBe('edit')
    expect(listDetailsFooterMode('in_progress', true)).toBe('continue')
    expect(listDetailsFooterMode('done', true)).toBe('done')
  })

  // "Sending automatically" is the canvas's own copy for a campaign that needs
  // nothing from you, and that is the honest answer for every paid channel
  // before it finishes: Peerly sends it, and we have neither an edit nor a
  // delete endpoint to put behind the scheduled mode's two buttons.
  it('answers automatic for anything still running that cannot be driven', () => {
    expect(listDetailsFooterMode('scheduled', false)).toBe('automatic')
    expect(listDetailsFooterMode('in_progress', false)).toBe('automatic')
  })

  // Finished outranks drivable. A done campaign is over for everyone, so it
  // gets the same footer whether or not we ran it ourselves.
  it('answers done regardless of who drove the campaign', () => {
    expect(listDetailsFooterMode('done', false)).toBe('done')
  })

  // Draft, In review, Denied and Pending payment have no canvas position, and
  // inventing one for them is exactly the fifth mode this set exists to
  // prevent.
  it('renders no footer for a lifecycle the canvas does not draw', () => {
    expect(listDetailsFooterMode(null, true)).toBe('none')
    expect(listDetailsFooterMode(null, false)).toBe('none')
  })
})
