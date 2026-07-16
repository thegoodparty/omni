import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, act } from '@testing-library/react'
import type { Ordinance } from '@goodparty_org/contracts'
import DraftDetail from './DraftDetail'

const mocks = vi.hoisted(() => ({
  updateOrdinance: vi.fn(),
  draftChatProps: {
    current: null as { seedText?: string; seedNonce?: number } | null,
  },
}))

vi.mock('../data/ordinances-api', () => ({
  updateOrdinance: mocks.updateOrdinance,
}))

// Stub the chat so the selection-toolbar tests can assert what the drawer
// hands DraftChat (seed text + nonce) without mounting the real streaming chat.
vi.mock('./DraftChat', () => ({
  default: (props: { seedText?: string; seedNonce?: number }) => {
    mocks.draftChatProps.current = props
    return null
  },
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

const editTitle = (text: string): void => {
  const el = screen.getByRole('textbox', { name: 'Ordinance draft title' })
  el.innerText = text
  fireEvent.input(el)
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

  it('autosaves a title edit as draftTitle only', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editTitle('A clearer title')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      {
        draftTitle: 'A clearer title',
      },
    )
  })

  it('does not PATCH an empty title', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editTitle('   ')
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

  it('surfaces an error and drops the queued edit when a save fails', async () => {
    let rejectFirst!: (e: Error) => void
    mocks.updateOrdinance.mockReturnValueOnce(
      new Promise<Ordinance>((_resolve, reject) => {
        rejectFirst = reject
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('first')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    editBody('second')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectFirst(new Error('save failed'))
    })

    // Error stays visible and the queued edit is dropped (no auto-retry).
    expect(screen.getByText("Couldn't save")).toBeVisible()
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)

    // A later edit still fires a fresh save.
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
    editBody('third')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(2)
    expect(mocks.updateOrdinance).toHaveBeenLastCalledWith(
      'public-safety-cameras',
      { draftBody: 'third' },
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

const selectPassage = (text: string): void => {
  const body = screen.getByRole('textbox', { name: 'Ordinance draft body' })
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: body,
      getBoundingClientRect: () => ({
        top: 120,
        left: 40,
        width: 60,
        height: 16,
      }),
    }),
    toString: () => text,
    removeAllRanges: vi.fn(),
  } as unknown as Selection)
  fireEvent(document, new Event('selectionchange'))
}

const clearSelection = (): void => {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: true,
    rangeCount: 0,
    getRangeAt: () => {
      throw new Error('collapsed')
    },
    toString: () => '',
    removeAllRanges: vi.fn(),
  } as unknown as Selection)
  fireEvent(document, new Event('selectionchange'))
}

describe('DraftDetail selection toolbar', () => {
  beforeEach(() => {
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
    mocks.draftChatProps.current = null
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the toolbar on selection and hides it when cleared', () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    expect(
      screen.queryByRole('toolbar', { name: 'Selection actions' }),
    ).not.toBeInTheDocument()

    selectPassage('a 30-day retention limit')
    expect(
      screen.getByRole('toolbar', { name: 'Selection actions' }),
    ).toBeVisible()

    clearSelection()
    expect(
      screen.queryByRole('toolbar', { name: 'Selection actions' }),
    ).not.toBeInTheDocument()
  })

  it('"Ask about this" seeds the chat with the passage and opens the drawer', () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    selectPassage('a 30-day retention limit')
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this' }))

    expect(mocks.draftChatProps.current).not.toBeNull()
    expect(mocks.draftChatProps.current?.seedText).toBe(
      'About this passage: "a 30-day retention limit"\n\n',
    )
    expect(mocks.draftChatProps.current?.seedNonce ?? 0).toBeGreaterThan(0)
  })

  it('"Flag a bug" seeds the chat with the problem template', () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    selectPassage('a 30-day retention limit')
    fireEvent.click(screen.getByRole('button', { name: /flag a bug/i }))

    expect(mocks.draftChatProps.current?.seedText).toBe(
      'I think there\'s a problem with this passage: "a 30-day retention limit"\n\n',
    )
    expect(mocks.draftChatProps.current?.seedNonce ?? 0).toBeGreaterThan(0)
  })
})
