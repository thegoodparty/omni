import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS } from 'helpers/analyticsHelper'
import type { Ordinance } from '@goodparty_org/contracts'
import DraftDetail from './DraftDetail'

const mocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  updateOrdinance: vi.fn(),
  startQualityReport: vi.fn(),
  fetchQualityRun: vi.fn(),
  deleteOrdinance: vi.fn(),
  downloadOrdinanceExport: vi.fn(),
  fetchOrdinanceBySlug: vi.fn(),
  cancelQualityLoop: vi.fn(),
  fetchQualityIterations: vi.fn(),
  createOrdinanceBugReport: vi.fn(),
  successSnackbar: vi.fn(),
  draftChatProps: {
    current: null as {
      seedText?: string
      seedNonce?: number
      autoDictate?: boolean
    } | null,
  },
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return {
    ...actual,
    trackEvent: (...args: unknown[]) => {
      mocks.trackEvent(...args)
      return Promise.resolve()
    },
  }
})

vi.mock('@shared/utils/Snackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: mocks.successSnackbar,
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

vi.mock('../data/ordinances-api', () => ({
  updateOrdinance: mocks.updateOrdinance,
  startQualityReport: mocks.startQualityReport,
  fetchQualityRun: mocks.fetchQualityRun,
  deleteOrdinance: mocks.deleteOrdinance,
  downloadOrdinanceExport: mocks.downloadOrdinanceExport,
  fetchOrdinanceBySlug: mocks.fetchOrdinanceBySlug,
  cancelQualityLoop: mocks.cancelQualityLoop,
  fetchQualityIterations: mocks.fetchQualityIterations,
  createOrdinanceBugReport: mocks.createOrdinanceBugReport,
}))

// Stub the chat so the selection-toolbar tests can assert what the drawer
// hands DraftChat (seed text + nonce) without mounting the real streaming chat.
vi.mock('./DraftChat', () => ({
  default: (props: {
    seedText?: string
    seedNonce?: number
    autoDictate?: boolean
  }) => {
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
    qualityRunStatus: 'idle',
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
    mocks.createOrdinanceBugReport.mockReset()
    mocks.createOrdinanceBugReport.mockResolvedValue(undefined)
    mocks.successSnackbar.mockReset()
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

  it('the launcher mic opens the chat with dictation auto-started', () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dictate a message' }))

    expect(mocks.draftChatProps.current?.autoDictate).toBe(true)
  })

  it('the launcher send button opens the chat without auto-dictation', () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Ask about this draft' }),
    )

    expect(mocks.draftChatProps.current).not.toBeNull()
    expect(mocks.draftChatProps.current?.autoDictate).toBe(false)
  })

  it('"Flag a bug" opens the report sheet and submits a bug report, not the chat', async () => {
    const user = userEvent.setup()
    render(<DraftDetail ordinance={makeOrdinance()} />)

    selectPassage('a 30-day retention limit')
    fireEvent.click(screen.getByRole('button', { name: /flag a bug/i }))

    // The report sheet opens (its own composer), and the chat is untouched.
    const description = await screen.findByPlaceholderText(
      'Describe the problem…',
    )
    expect(mocks.draftChatProps.current).toBeNull()

    await user.type(description, 'The retention window is wrong.')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(mocks.createOrdinanceBugReport).toHaveBeenCalledWith(
        'public-safety-cameras',
        {
          description: 'The retention window is wrong.',
          excerpt: 'a 30-day retention limit',
        },
      )
    })
    expect(mocks.successSnackbar).toHaveBeenCalledWith(
      'Thanks — your bug report was submitted',
    )
  })
})

const sampleReport = {
  checks: [{ id: 'authority', label: 'Authority', status: 'pass', note: 'ok' }],
  tally: { pass: 1, flag: 0, attention: 0 },
  stale: false,
  ranAgainstBodyHash: 'hash-1',
}

// Real timers here: clicking Run flushes (and clears) the debounce timer
// synchronously, so these exercise the flush/stale wiring without a fake clock.
describe('DraftDetail quality report flush', () => {
  beforeEach(() => {
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
    mocks.startQualityReport.mockReset()
    mocks.startQualityReport.mockResolvedValue({
      status: 'done',
      report: sampleReport,
      error: null,
      startedAt: null,
    })
    mocks.fetchQualityRun.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flushes a pending edit before generating the report', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('flushed edit')
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(await screen.findByText(/reviewed by/i)).toBeVisible()
    // The pending edit was saved (with its latest text) before the run.
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      { draftBody: 'flushed edit' },
    )
    expect(mocks.startQualityReport).toHaveBeenCalledWith(
      'public-safety-cameras',
      { signal: expect.any(AbortSignal) },
    )
  })

  it('aborts the run and does not generate when the flush save fails', async () => {
    mocks.updateOrdinance.mockRejectedValue(new Error('save failed'))

    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('edit that fails to save')
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
    expect(mocks.startQualityReport).not.toHaveBeenCalled()
  })

  it('recovers on a later run after a failed flush save instead of dead-ending', async () => {
    mocks.updateOrdinance.mockRejectedValueOnce(new Error('blip'))

    render(<DraftDetail ordinance={makeOrdinance()} />)

    editBody('edited during a blip')
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    // First run aborts because the flush save failed.
    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
    expect(mocks.startQualityReport).not.toHaveBeenCalled()

    // The next run re-saves the current text (network recovered) and proceeds,
    // rather than dead-ending on the stale failure flag.
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(await screen.findByText(/reviewed by/i)).toBeVisible()
    expect(mocks.startQualityReport).toHaveBeenCalledWith(
      'public-safety-cameras',
      { signal: expect.any(AbortSignal) },
    )
  })

  it('resumes a running quality check from the ordinance run status', () => {
    mocks.fetchQualityRun.mockResolvedValue({
      status: 'running',
      report: sampleReport,
      error: null,
      startedAt: '2026-07-01T00:00:00.000Z',
    })

    render(
      <DraftDetail
        ordinance={makeOrdinance({
          qualityReport: sampleReport,
          qualityRunStatus: 'running',
        } as Partial<Ordinance>)}
      />,
    )

    // The check kicked off before this mount (reload mid-run), so the report
    // section opens directly in its loading state without a click.
    expect(screen.getByText(/reviewing the draft/i)).toBeVisible()
    expect(mocks.startQualityReport).not.toHaveBeenCalled()
  })

  it('shows the stale banner once a real edit settles', async () => {
    // Dirty is decided at the debounce (where the reserialization check
    // lives), not on the raw input event — a no-op input must never stale
    // the report, so a real edit's banner appears when the autosave fires.
    vi.useFakeTimers()
    try {
      render(
        <DraftDetail
          ordinance={makeOrdinance({
            qualityReport: sampleReport,
          } as Partial<Ordinance>)}
        />,
      )

      expect(screen.queryByText(/the draft changed/i)).not.toBeInTheDocument()

      editBody('a new edit')
      expect(screen.queryByText(/the draft changed/i)).not.toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100)
      })
      expect(screen.getByText(/the draft changed/i)).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the stale banner after a successful re-run', async () => {
    render(
      <DraftDetail
        ordinance={makeOrdinance({
          qualityReport: { ...sampleReport, stale: true },
        } as Partial<Ordinance>)}
      />,
    )

    // Starts stale (server-reported).
    expect(screen.getByText(/the draft changed/i)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    await waitFor(() =>
      expect(screen.queryByText(/the draft changed/i)).not.toBeInTheDocument(),
    )
  })
})

describe('DraftDetail header actions', () => {
  beforeEach(() => {
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
    mocks.deleteOrdinance.mockReset()
    mocks.deleteOrdinance.mockResolvedValue(undefined)
    mocks.downloadOrdinanceExport.mockReset()
    mocks.downloadOrdinanceExport.mockResolvedValue(undefined)
    router.push?.mockReset?.()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers PDF and Word options in the download menu', async () => {
    const user = userEvent.setup()
    render(<DraftDetail ordinance={makeOrdinance()} />)

    await user.click(screen.getByRole('button', { name: /download draft/i }))

    expect(await screen.findByText(/download as pdf/i)).toBeVisible()
    expect(screen.getByText(/download as word/i)).toBeVisible()
  })

  it('downloads the draft as PDF and Word from the download menu', async () => {
    const user = userEvent.setup()
    render(<DraftDetail ordinance={makeOrdinance()} />)

    await user.click(screen.getByRole('button', { name: /download draft/i }))
    await user.click(screen.getByRole('menuitem', { name: /download as pdf/i }))
    expect(mocks.downloadOrdinanceExport).toHaveBeenCalledWith(
      'public-safety-cameras',
      'pdf',
    )

    await user.click(screen.getByRole('button', { name: /download draft/i }))
    await user.click(
      screen.getByRole('menuitem', { name: /download as word/i }),
    )
    expect(mocks.downloadOrdinanceExport).toHaveBeenCalledWith(
      'public-safety-cameras',
      'docx',
    )
  })

  it('surfaces an error when an export fails', async () => {
    const user = userEvent.setup()
    mocks.downloadOrdinanceExport.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance()} />)

    await user.click(screen.getByRole('button', { name: /download draft/i }))
    await user.click(screen.getByRole('menuitem', { name: /download as pdf/i }))

    expect(await screen.findByText(/could not export the draft/i)).toBeVisible()
  })

  it('changes the status from the status dropdown', async () => {
    const user = userEvent.setup()
    render(<DraftDetail ordinance={makeOrdinance({ status: 'draft' })} />)

    await user.click(
      screen.getByRole('button', { name: /change draft status/i }),
    )

    // in_progress is the pre-draft state and is never offered manually.
    expect(
      screen.queryByRole('menuitem', { name: /in progress/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /in review/i }))

    await waitFor(() =>
      expect(mocks.updateOrdinance).toHaveBeenCalledWith(
        'public-safety-cameras',
        { status: 'in_review' },
      ),
    )
  })

  it('reverts the status pill when the change fails', async () => {
    const user = userEvent.setup()
    mocks.updateOrdinance.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance({ status: 'proposed' })} />)

    const trigger = screen.getByRole('button', { name: /change draft status/i })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: /in review/i }))

    await waitFor(() =>
      expect(mocks.updateOrdinance).toHaveBeenCalledWith(
        'public-safety-cameras',
        { status: 'in_review' },
      ),
    )
    // The optimistic pick reverts to the original status after the save fails.
    await waitFor(() => expect(trigger).toHaveTextContent(/proposed/i))
  })

  it('deletes the draft after confirming and returns to the list', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete draft/i }))

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /delete draft/i }),
    )

    await waitFor(() =>
      expect(mocks.deleteOrdinance).toHaveBeenCalledWith(
        'public-safety-cameras',
      ),
    )
    expect(router.push).toHaveBeenCalledWith('/dashboard/ordinances')
  })

  it('surfaces an error and stays open when the delete fails', async () => {
    mocks.deleteOrdinance.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete draft/i }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /delete draft/i }),
    )

    expect(await screen.findByText(/could not delete the draft/i)).toBeVisible()
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('DraftDetail analytics', () => {
  beforeEach(() => {
    mocks.trackEvent.mockReset()
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
    mocks.deleteOrdinance.mockReset()
    mocks.deleteOrdinance.mockResolvedValue(undefined)
    mocks.downloadOrdinanceExport.mockReset()
    mocks.downloadOrdinanceExport.mockResolvedValue(undefined)
    router.push?.mockReset?.()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires Draft Details Viewed with the draft id on mount', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    await waitFor(() =>
      expect(mocks.trackEvent).toHaveBeenCalledWith(
        EVENTS.Ordinances.DraftDetailsViewed,
        { draftId: 'ord-1' },
      ),
    )
  })

  it.each([
    [/download as pdf/i, 'pdf'],
    [/download as word/i, 'word'],
  ])(
    'fires Draft Details Downloaded with type %s after a successful export',
    async (menuItem, type) => {
      const user = userEvent.setup()
      render(<DraftDetail ordinance={makeOrdinance()} />)

      await user.click(screen.getByRole('button', { name: /download draft/i }))
      await user.click(screen.getByRole('menuitem', { name: menuItem }))

      await waitFor(() =>
        expect(mocks.trackEvent).toHaveBeenCalledWith(
          EVENTS.Ordinances.DraftDetailsDownloaded,
          { draftId: 'ord-1', type },
        ),
      )
    },
  )

  it('does not fire Downloaded when the export fails', async () => {
    const user = userEvent.setup()
    mocks.downloadOrdinanceExport.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance()} />)

    await user.click(screen.getByRole('button', { name: /download draft/i }))
    await user.click(screen.getByRole('menuitem', { name: /download as pdf/i }))

    expect(await screen.findByText(/could not export the draft/i)).toBeVisible()
    expect(mocks.trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Ordinances.DraftDetailsDownloaded,
      expect.anything(),
    )
  })

  it('fires Draft Details Status Updated after a successful change', async () => {
    const user = userEvent.setup()
    render(<DraftDetail ordinance={makeOrdinance({ status: 'draft' })} />)

    await user.click(
      screen.getByRole('button', { name: /change draft status/i }),
    )
    await user.click(screen.getByRole('menuitem', { name: /in review/i }))

    await waitFor(() =>
      expect(mocks.trackEvent).toHaveBeenCalledWith(
        EVENTS.Ordinances.DraftDetailsStatusUpdated,
        { draftId: 'ord-1', status: 'in_review' },
      ),
    )
  })

  it('does not fire Status Updated when the change fails', async () => {
    const user = userEvent.setup()
    mocks.updateOrdinance.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance({ status: 'proposed' })} />)

    const trigger = screen.getByRole('button', { name: /change draft status/i })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: /in review/i }))

    await waitFor(() => expect(trigger).toHaveTextContent(/proposed/i))
    expect(mocks.trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Ordinances.DraftDetailsStatusUpdated,
      expect.anything(),
    )
  })

  it('fires Draft Details Deleted after a confirmed delete', async () => {
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete draft/i }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /delete draft/i }),
    )

    await waitFor(() =>
      expect(mocks.trackEvent).toHaveBeenCalledWith(
        EVENTS.Ordinances.DraftDetailsDeleted,
        { draftId: 'ord-1' },
      ),
    )
    expect(router.push).toHaveBeenCalledWith('/dashboard/ordinances')
  })

  it('does not fire Deleted when the delete fails', async () => {
    mocks.deleteOrdinance.mockRejectedValue(new Error('nope'))
    render(<DraftDetail ordinance={makeOrdinance()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete draft/i }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /delete draft/i }),
    )

    expect(await screen.findByText(/could not delete the draft/i)).toBeVisible()
    expect(mocks.trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Ordinances.DraftDetailsDeleted,
      expect.anything(),
    )
  })
})
