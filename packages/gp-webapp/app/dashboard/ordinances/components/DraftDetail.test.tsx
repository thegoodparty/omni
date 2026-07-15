import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import type { Ordinance } from '@goodparty_org/contracts'
import DraftDetail from './DraftDetail'

const mocks = vi.hoisted(() => ({ updateOrdinance: vi.fn() }))

vi.mock('../data/ordinances-api', () => ({
  updateOrdinance: mocks.updateOrdinance,
}))

const AUTOSAVE_DELAY_MS = 800

const makeOrdinance = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({
    id: 'ord-1',
    slug: 'public-safety-cameras',
    status: 'draft',
    draftTitle: 'Draft amendment to Chapter 12',
    goalText: 'Add camera guardrails',
    draftBody: 'Original body.',
    draftSources: null,
    ...overrides,
  }) as unknown as Ordinance

const editBody = (text: string): void => {
  const body = screen.getByRole('textbox', { name: 'Ordinance draft body' })
  body.innerText = text
  fireEvent.input(body)
}

describe('DraftDetail autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses rapid edits within the debounce window into one save', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('first edit')
    editBody('second edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      {
        draftBody: 'second edit',
      },
    )
  })

  it('does not PATCH an empty body (the contract requires min length 1)', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    expect(mocks.updateOrdinance).not.toHaveBeenCalled()
  })

  it('serializes saves so an in-flight PATCH is not raced', async () => {
    let resolveFirst!: (v: Ordinance) => void
    mocks.updateOrdinance.mockReturnValueOnce(
      new Promise<Ordinance>((r) => {
        resolveFirst = r
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('first')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    editBody('second')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    // Only the first save has gone out; the second is queued behind it.
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)

    resolveFirst(makeOrdinance())
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(2)
    expect(mocks.updateOrdinance).toHaveBeenLastCalledWith(
      'public-safety-cameras',
      { draftBody: 'second' },
    )
  })

  it('flushes a pending edit on unmount so the last change is not dropped', () => {
    const { unmount } = render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('edited right before leaving')
    // Leave before the debounce fires.
    unmount()

    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      {
        draftBody: 'edited right before leaving',
      },
    )
  })

  it('surfaces a saved state after a successful save', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('a real edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    // Flush the resolved-save microtask that flips saveState to 'saved'.
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Saved')).toBeVisible()
  })
})
