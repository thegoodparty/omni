import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, act, waitFor } from '@testing-library/react'
import type {
  Ordinance,
  OrdinanceQualityIterationSummary,
  OrdinanceQualityLoop,
  OrdinanceQualityReport,
} from '@goodparty_org/contracts'
import DraftDetail from './DraftDetail'

const mocks = vi.hoisted(() => ({
  updateOrdinance: vi.fn(),
  startQualityReport: vi.fn(),
  fetchQualityRun: vi.fn(),
  deleteOrdinance: vi.fn(),
  downloadOrdinanceExport: vi.fn(),
  fetchOrdinanceBySlug: vi.fn(),
  cancelQualityLoop: vi.fn(),
  fetchQualityIterations: vi.fn(),
  useOrdinanceQualityLoopFlag: vi.fn(),
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
}))

vi.mock('@shared/experiments/ordinanceQualityLoopFlag', () => ({
  useOrdinanceQualityLoopFlag: mocks.useOrdinanceQualityLoopFlag,
}))

vi.mock('@shared/utils/Snackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

vi.mock('./DraftChat', () => ({
  default: () => null,
}))

const AUTOSAVE_DELAY_MS = 800
const LOOP_POLL_MS = 5_000

const loop = (
  overrides: Partial<OrdinanceQualityLoop> = {},
): OrdinanceQualityLoop => ({
  status: 'running',
  phase: 'checking',
  passNumber: 1,
  maxPasses: 4,
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const report = (
  overrides: Partial<OrdinanceQualityReport> = {},
): OrdinanceQualityReport => ({
  checks: [
    {
      id: 'legal_conflict',
      label: 'Legal conflict',
      status: 'flag',
      note: 'Conflicts with Chapter 12.',
    },
    {
      id: 'completeness',
      label: 'Completeness',
      status: 'attention',
      note: 'Add an effective date.',
    },
  ],
  tally: { pass: 4, flag: 1, attention: 1 },
  stale: false,
  ranAgainstBodyHash: 'hash-1',
  ...overrides,
})

const passingReport = report({
  checks: [
    {
      id: 'completeness',
      label: 'Completeness',
      status: 'attention',
      note: 'Add an effective date.',
    },
    {
      id: 'clarity',
      label: 'Clarity',
      status: 'attention',
      note: 'Define "recording".',
    },
  ],
  tally: { pass: 4, flag: 0, attention: 2 },
  ranAgainstBodyHash: 'hash-2',
})

const makeOrdinance = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({
    id: 'ord-1',
    slug: 'public-safety-cameras',
    status: 'draft',
    draftTitle: 'Draft amendment to Chapter 12',
    goalText: 'Add camera guardrails',
    draftBody: 'Original body.',
    draftSources: null,
    qualityReport: null,
    qualityRunStatus: 'idle',
    qualityLoop: null,
    ...overrides,
  }) as unknown as Ordinance

const iteration = (
  overrides: Partial<OrdinanceQualityIterationSummary> = {},
): OrdinanceQualityIterationSummary => ({
  iteration: 0,
  flaggedCheckIds: ['legal_conflict'],
  report: report(),
  draftTitle: 'Original title',
  draftBody: 'Original body.',
  draftSources: [{ id: 's0', title: 'N.C.G.S. § 160A-174' }],
  revisedTitle: 'Improved title',
  revisedBody: 'Improved body.',
  revisionNotes: [
    { checkId: 'legal_conflict', note: 'Removed the conflicting clause.' },
  ],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const bodyEditor = (): HTMLElement =>
  screen.getByRole('textbox', { name: 'Ordinance draft body' })
const titleEditor = (): HTMLElement =>
  screen.getByRole('textbox', { name: 'Ordinance draft title' })

beforeEach(() => {
  mocks.updateOrdinance.mockReset()
  mocks.updateOrdinance.mockResolvedValue(makeOrdinance())
  mocks.startQualityReport.mockReset()
  mocks.fetchQualityRun.mockReset()
  mocks.deleteOrdinance.mockReset()
  mocks.downloadOrdinanceExport.mockReset()
  mocks.fetchOrdinanceBySlug.mockReset()
  mocks.cancelQualityLoop.mockReset()
  mocks.fetchQualityIterations.mockReset()
  mocks.fetchQualityIterations.mockResolvedValue({
    loopRunId: 'run-1',
    iterations: [],
  })
  mocks.useOrdinanceQualityLoopFlag.mockReset()
  mocks.useOrdinanceQualityLoopFlag.mockReturnValue({
    ready: true,
    enabled: true,
  })
})

describe('DraftDetail quality loop polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls every 5s while running and settles into the converged outcome', async () => {
    mocks.fetchOrdinanceBySlug
      .mockResolvedValueOnce(
        makeOrdinance({
          qualityLoop: loop({ phase: 'revising', passNumber: 1 }),
        }),
      )
      .mockResolvedValueOnce(
        makeOrdinance({
          qualityLoop: loop({ status: 'converged', phase: null }),
          qualityReport: passingReport,
          draftTitle: 'Improved title',
          draftBody: 'Improved body.',
        }),
      )
    mocks.fetchQualityIterations.mockResolvedValue({
      loopRunId: 'run-1',
      iterations: [iteration()],
    })

    render(
      <DraftDetail
        ordinance={makeOrdinance({
          qualityLoop: loop(),
          qualityReport: report(),
        })}
      />,
    )

    expect(screen.getByText('Checking your draft (pass 1 of 4)')).toBeVisible()
    expect(mocks.fetchOrdinanceBySlug).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS)
    })
    expect(mocks.fetchOrdinanceBySlug).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/rewriting flagged sections/i)).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS)
    })
    expect(mocks.fetchOrdinanceBySlug).toHaveBeenCalledTimes(2)

    // Terminal: the running banner clears and the report card is the only
    // state left — no outcome box, no history fetch. The design keeps the
    // report as the single quality surface so loops can run repeatedly
    // without a stale receipt lingering between them.
    expect(
      screen.queryByText(/rewriting flagged sections/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/no blocking problems/i)).not.toBeInTheDocument()
    expect(mocks.fetchQualityIterations).not.toHaveBeenCalled()

    // The editor unlocked and was re-seeded with the revised draft.
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    expect(bodyEditor().innerText).toBe('Improved body.')
    expect(titleEditor().innerText).toBe('Improved title')

    // Polling stopped with the loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS * 3)
    })
    expect(mocks.fetchOrdinanceBySlug).toHaveBeenCalledTimes(2)
  })

  it('re-seeds the editor from the server on every running tick', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        qualityLoop: loop({ passNumber: 2 }),
        draftBody: 'Mid-loop revised body.',
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS)
    })

    expect(screen.getByText('Checking your draft (pass 2 of 4)')).toBeVisible()
    expect(bodyEditor().innerText).toBe('Mid-loop revised body.')
  })

  it('locks the editor and mutes autosave while the loop runs', async () => {
    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    expect(bodyEditor()).toHaveAttribute('contenteditable', 'false')
    expect(bodyEditor()).toHaveAttribute('aria-readonly', 'true')
    expect(titleEditor()).toHaveAttribute('contenteditable', 'false')
    expect(titleEditor()).toHaveAttribute('aria-readonly', 'true')

    // Even if an input event slips through, no autosave PATCH goes out.
    bodyEditor().innerText = 'a sneaky edit'
    fireEvent.input(bodyEditor())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    })
    expect(mocks.updateOrdinance).not.toHaveBeenCalled()

    // The chat entry point is replaced by the explanatory note.
    expect(
      screen.getByText(
        'Improvements are running — stop them to edit or discuss',
      ),
    ).toBeVisible()
    expect(
      screen.queryByText('Ask about this draft...'),
    ).not.toBeInTheDocument()
  })

  it('unlocks with no outcome box after a stopped_* terminal', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        qualityLoop: loop({ status: 'stopped_not_improving', phase: null }),
        qualityReport: report(),
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS)
    })

    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    expect(
      screen.queryByText(/kept your strongest version/i),
    ).not.toBeInTheDocument()
  })

  it('keeps unsaved edits when a re-check discovers a loop started elsewhere', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ qualityLoop: loop(), draftBody: 'Loop revision.' }),
    )

    render(<DraftDetail ordinance={makeOrdinance()} />)

    // An edit sits in the debounce window when a focus re-check learns a loop
    // started elsewhere (another tab, the saveDraft hook). The user's live
    // typing is authoritative: reseeding would silently discard it. The
    // pending autosave lands and retires the young run through the edit
    // supersession hook instead of being dropped.
    bodyEditor().innerText = 'Pre-loop edit.'
    fireEvent.input(bodyEditor())
    fireEvent(window, new Event('focus'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'false')
    expect(bodyEditor().innerText).toBe('Pre-loop edit.')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    })
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      { draftBody: 'Pre-loop edit.' },
    )
  })

  it('ignores a stale in-flight poll snapshot after Stop and edit', async () => {
    let releasePoll: (o: Ordinance) => void = () => undefined
    mocks.fetchOrdinanceBySlug.mockImplementation(
      () =>
        new Promise<Ordinance>((resolve) => {
          releasePoll = resolve
        }),
    )
    mocks.cancelQualityLoop.mockResolvedValue(
      makeOrdinance({
        qualityLoop: loop({ status: 'cancelled', phase: null }),
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    // A poll goes out and hangs on the wire...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOP_POLL_MS)
    })
    const stalePoll = releasePoll

    // ...the user stops, the editor unlocks, and they resume typing.
    fireEvent.click(screen.getByRole('button', { name: /stop and edit/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    bodyEditor().innerText = 'Typed after stopping.'
    fireEvent.input(bodyEditor())

    // The pre-stop snapshot finally lands, still claiming "running" — it must
    // not re-lock the editor or reseed over the fresh typing.
    await act(async () => {
      stalePoll(
        makeOrdinance({
          qualityLoop: loop(),
          draftBody: 'Stale server copy.',
        }),
      )
    })

    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    expect(bodyEditor().innerText).toBe('Typed after stopping.')
  })
})

describe('DraftDetail selection toolbar while the loop runs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never shows the selection toolbar while the loop runs', () => {
    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    const body = bodyEditor()
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
      toString: () => 'a 30-day retention limit',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)
    fireEvent(document, new Event('selectionchange'))

    expect(
      screen.queryByRole('toolbar', { name: 'Selection actions' }),
    ).not.toBeInTheDocument()
  })
})

describe('DraftDetail quality loop stop and edit', () => {
  it('cancels the loop and unlocks the editor', async () => {
    mocks.cancelQualityLoop.mockResolvedValue(
      makeOrdinance({
        qualityLoop: loop({ status: 'cancelled', phase: null }),
        qualityReport: report(),
      }),
    )

    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    fireEvent.click(screen.getByRole('button', { name: /stop and edit/i }))

    await waitFor(() =>
      expect(mocks.cancelQualityLoop).toHaveBeenCalledWith(
        'public-safety-cameras',
      ),
    )
    await waitFor(() =>
      expect(bodyEditor()).toHaveAttribute('contenteditable', 'true'),
    )
    expect(screen.queryByText(/checking your draft/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/improvements stopped/i)).not.toBeInTheDocument()
  })

  it('surfaces an error and stays locked when the cancel fails', async () => {
    mocks.cancelQualityLoop.mockRejectedValue(new Error('nope'))

    render(<DraftDetail ordinance={makeOrdinance({ qualityLoop: loop() })} />)

    fireEvent.click(screen.getByRole('button', { name: /stop and edit/i }))

    expect(
      await screen.findByText(/could not stop the improvements/i),
    ).toBeVisible()
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'false')
  })
})

describe('DraftDetail quality loop focus re-check', () => {
  it('re-checks the loop state on window focus and locks when one is running', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ qualityLoop: loop() }),
    )

    render(<DraftDetail ordinance={makeOrdinance()} />)

    expect(screen.queryByText(/checking your draft/i)).not.toBeInTheDocument()
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')

    fireEvent(window, new Event('focus'))

    expect(
      await screen.findByText('Checking your draft (pass 1 of 4)'),
    ).toBeVisible()
    expect(mocks.fetchOrdinanceBySlug).toHaveBeenCalledTimes(1)
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'false')
  })

  it('leaves unsaved edits intact when the focus re-check finds no running loop', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(makeOrdinance())

    render(<DraftDetail ordinance={makeOrdinance()} />)

    // Unsaved local typing must survive the re-check — a reseed here would
    // silently clobber it with the server copy.
    bodyEditor().innerText = 'Unsaved local edit.'
    fireEvent.input(bodyEditor())
    fireEvent(window, new Event('focus'))
    await waitFor(() =>
      expect(mocks.fetchOrdinanceBySlug).toHaveBeenCalledTimes(1),
    )

    expect(bodyEditor().innerText).toBe('Unsaved local edit.')
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByText(/checking your draft/i)).not.toBeInTheDocument()
  })
})

describe('DraftDetail loop terminal on load', () => {
  it('shows no outcome box and fetches no history for a loop that ended while the page was closed', async () => {
    render(
      <DraftDetail
        ordinance={makeOrdinance({
          qualityLoop: loop({ status: 'converged', phase: null }),
          qualityReport: passingReport,
        })}
      />,
    )

    // The report card is the only quality surface; a long-finished loop
    // must not greet a fresh load with a stale receipt.
    expect(bodyEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByText(/no blocking problems/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/what changed/i)).not.toBeInTheDocument()
    expect(mocks.fetchQualityIterations).not.toHaveBeenCalled()
  })
})

describe('DraftDetail quality panel (design: refresh only, loop is auto)', () => {
  // Design contract (Lovable QualityReport): the panel control re-grades via
  // the async claim-and-poll run; the loop has no manual trigger anywhere.
  it('runs the manual check from the panel — never the loop', async () => {
    mocks.startQualityReport.mockResolvedValue({
      status: 'done',
      report: null,
      error: null,
    })

    render(<DraftDetail ordinance={makeOrdinance()} />)

    expect(
      screen.queryByRole('button', { name: /check & improve/i }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    await act(() => Promise.resolve())
    expect(mocks.startQualityReport).toHaveBeenCalledWith(
      'public-safety-cameras',
      expect.anything(),
    )
  })

  it('skips the autosave PATCH when input reserializes the same text', async () => {
    vi.useFakeTimers()
    try {
      render(
        <DraftDetail ordinance={makeOrdinance({ qualityReport: report() })} />,
      )

      // An input event whose innerText round-trips to the already-persisted
      // serialization (loop reseed, caret placement, spellcheck no-op) must
      // not PATCH: a byte-shuffled body invalidates the quality report's
      // input hash and staled the report right after a loop finished.
      fireEvent.input(bodyEditor())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100)
      })

      expect(mocks.updateOrdinance).not.toHaveBeenCalled()
      // And it must not flag the hash-fresh report stale either — the banner
      // would demand a paid re-grade that returns the identical report.
      expect(
        screen.queryByText(/draft changed since this report ran/i),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pre-run flush also skips a reserialized no-op edit', async () => {
    mocks.startQualityReport.mockResolvedValue({
      status: 'done',
      report: report(),
      error: null,
    })

    render(<DraftDetail ordinance={makeOrdinance()} />)

    // Pending debounce timer whose text round-trips unchanged, then an
    // immediate run: the flush must not PATCH byte-identical text right
    // before grading (it would shuffle the hash the report is graded against).
    fireEvent.input(bodyEditor())
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    await act(() => Promise.resolve())
    expect(mocks.startQualityReport).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrdinance).not.toHaveBeenCalled()
  })

  it('a failed save clears the snapshot so identical retyped text saves again', async () => {
    vi.useFakeTimers()
    try {
      mocks.updateOrdinance.mockRejectedValueOnce(new Error('net'))

      render(<DraftDetail ordinance={makeOrdinance()} />)

      bodyEditor().innerText = 'Changed body.'
      fireEvent.input(bodyEditor())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100)
      })
      expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)

      // The snapshot was optimistically advanced to 'Changed body.' before
      // the PATCH failed; without the failure reset, this identical retype
      // would be skipped as a no-op and the server would stay stale forever.
      fireEvent.input(bodyEditor())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100)
      })
      expect(mocks.updateOrdinance).toHaveBeenCalledTimes(2)
      expect(mocks.updateOrdinance).toHaveBeenLastCalledWith(
        'public-safety-cameras',
        { draftBody: 'Changed body.' },
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
