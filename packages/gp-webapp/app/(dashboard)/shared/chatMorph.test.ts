import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markArrivingAtHome, morphComposerOutOfPill } from './chatMorph'

// jsdom has no layout or Web Animations, so these cover the bookkeeping that
// decides whether Home's chat box ends up visible, not the motion itself.

const composerBox = (): HTMLElement => {
  const el = document.createElement('form')
  el.setAttribute('data-chat-morph', 'composer')
  el.getAnimations = () => []
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'],
  })
  window.sessionStorage.clear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('morphComposerOutOfPill', () => {
  it('leaves the box alone when Home was not reached from the sidebar', () => {
    const composer = composerBox()
    morphComposerOutOfPill(composer)

    expect(composer.style.opacity).toBe('')
  })

  it('shows the box again even when it is attached twice while waiting', () => {
    markArrivingAtHome()
    const composer = composerBox()

    // React's dev double mount attaches the same box twice.
    morphComposerOutOfPill(composer)
    morphComposerOutOfPill(composer)
    expect(composer.style.opacity).toBe('0')

    // No pill ever renders, so the wait runs out and the box is shown as-is.
    vi.advanceTimersByTime(1000)
    expect(composer.style.opacity).toBe('')
    expect(composer.dataset.chatMorphPending).toBeUndefined()
  })
})
