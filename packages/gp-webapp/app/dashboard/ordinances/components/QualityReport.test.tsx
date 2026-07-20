import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, act } from '@testing-library/react'
import type {
  OrdinanceQualityReport,
  OrdinanceQualityRun,
} from '@goodparty_org/contracts'
import QualityReport from './QualityReport'

const mocks = vi.hoisted(() => ({
  startQualityReport: vi.fn(),
  fetchQualityRun: vi.fn(),
}))

vi.mock('../data/ordinances-api', () => ({
  startQualityReport: mocks.startQualityReport,
  fetchQualityRun: mocks.fetchQualityRun,
}))

const report = (
  overrides: Partial<OrdinanceQualityReport> = {},
): OrdinanceQualityReport => ({
  checks: [
    {
      id: 'authority',
      label: 'Authority',
      status: 'pass',
      note: 'Solid.',
      source: { id: 's-auth', title: 'Or. Rev. Stat. § 227.215' },
    },
    {
      id: 'legal_conflict',
      label: 'Legal conflict',
      status: 'flag',
      note: 'Conflicts with Chapter 12.',
    },
    {
      id: 'precedent_grounding',
      label: 'Precedent grounding',
      status: 'pass',
      note: 'Grounded.',
    },
    {
      id: 'completeness',
      label: 'Completeness',
      status: 'attention',
      note: 'Add an effective date.',
    },
    { id: 'clarity', label: 'Clarity', status: 'pass', note: 'Clear.' },
    { id: 'voice', label: 'Voice', status: 'pass', note: 'Good.' },
  ],
  tally: { pass: 4, flag: 1, attention: 1 },
  stale: false,
  ranAgainstBodyHash: 'hash-1',
  ...overrides,
})

const qualityRun = (
  overrides: Partial<OrdinanceQualityRun> = {},
): OrdinanceQualityRun => ({
  status: 'done',
  report: report(),
  error: null,
  startedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const props = (over: Partial<Parameters<typeof QualityReport>[0]> = {}) => ({
  slug: 'tree-canopy',
  initialReport: report(),
  initialRunStatus: 'idle' as const,
  draftDirty: false,
  onReran: vi.fn(),
  onDiscussFinding: vi.fn(),
  ...over,
})

describe('QualityReport', () => {
  beforeEach(() => {
    mocks.startQualityReport.mockReset()
    mocks.fetchQualityRun.mockReset()
  })

  it('renders the six checks and tally from the report', () => {
    render(<QualityReport {...props()} />)

    expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(screen.getByText('Authority')).toBeVisible()
    expect(screen.getByText('Conflicts with Chapter 12.')).toBeVisible()
    expect(screen.getByText('4 pass')).toBeVisible()
  })

  it('shows a check source on the collapsed row', () => {
    render(<QualityReport {...props()} />)

    // The source chip is visible without expanding the check.
    expect(screen.getByText('Or. Rev. Stat. § 227.215')).toBeVisible()
  })

  it('renders the report without polling when the server returns done directly', async () => {
    const onReran = vi.fn()
    mocks.startQualityReport.mockResolvedValue(qualityRun())

    render(<QualityReport {...props({ initialReport: null, onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(mocks.startQualityReport).toHaveBeenCalledWith('tree-canopy', {
      signal: expect.any(AbortSignal),
    })
    // Server-side fresh-report idempotency: a 'done' response ends the run —
    // no poll requests are ever made.
    expect(mocks.fetchQualityRun).not.toHaveBeenCalled()
    expect(onReran).toHaveBeenCalled()
  })

  it('disables the run button and shows a reviewing state while running', async () => {
    let resolveRun: ((value: OrdinanceQualityRun) => void) | undefined
    mocks.startQualityReport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve
        }),
    )

    render(<QualityReport {...props({ initialReport: null })} />)
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    const button = await screen.findByRole('button', { name: /reviewing/i })
    expect(button).toBeDisabled()

    // Settle the run so the test doesn't leak a pending state update.
    resolveRun?.(qualityRun())
    await screen.findByText(/reviewed by 6 checks/i)
  })

  it('surfaces an error when the run fails', async () => {
    mocks.startQualityReport.mockRejectedValue(new Error('nope'))

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
  })

  it('surfaces the API error message when the run is rejected with one', async () => {
    mocks.startQualityReport.mockRejectedValue({
      data: { message: 'Cannot run quality checks on an empty draft' },
    })

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/cannot run quality checks on an empty draft/i),
    ).toBeVisible()
  })

  it('surfaces an error when the run completes with no report', async () => {
    const onReran = vi.fn()
    mocks.startQualityReport.mockResolvedValue(qualityRun({ report: null }))

    render(<QualityReport {...props({ initialReport: null, onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/quality report was not returned/i),
    ).toBeVisible()
    expect(onReran).not.toHaveBeenCalled()
  })

  it('keeps the existing report visible when a re-run completes with no report', async () => {
    const onReran = vi.fn()
    mocks.startQualityReport.mockResolvedValue(qualityRun({ report: null }))

    render(<QualityReport {...props({ onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    expect(
      await screen.findByText(/did not return an updated report/i),
    ).toBeVisible()
    // The previously displayed report is not wiped by the failed re-run.
    expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(onReran).not.toHaveBeenCalled()
  })

  it('flushes pending edits before starting the run on re-run', async () => {
    const calls: string[] = []
    const onBeforeRun = vi.fn(async () => {
      calls.push('flush')
    })
    mocks.startQualityReport.mockImplementation(async () => {
      calls.push('start')
      return qualityRun()
    })

    render(<QualityReport {...props({ onBeforeRun })} />)

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    await screen.findByText(/reviewed by 6 checks/i)
    expect(onBeforeRun).toHaveBeenCalledTimes(1)
    // The flush is awaited before the run is started.
    expect(calls).toEqual(['flush', 'start'])
  })

  it('aborts the run and shows an error when onBeforeRun (flush) fails', async () => {
    const onBeforeRun = vi.fn().mockRejectedValue(new Error('save failed'))
    render(<QualityReport {...props({ onBeforeRun })} />)

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
    expect(mocks.startQualityReport).not.toHaveBeenCalled()
    // The existing report stays on screen.
    expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
  })

  it('shows a stale banner from the server report', () => {
    render(
      <QualityReport {...props({ initialReport: report({ stale: true }) })} />,
    )

    expect(screen.getByText(/the draft changed/i)).toBeVisible()
  })

  it('shows a stale banner when the draft was edited this session', () => {
    render(<QualityReport {...props({ draftDirty: true })} />)

    expect(screen.getByText(/the draft changed/i)).toBeVisible()
  })

  it('expands a check to reveal its Discuss action and calls onDiscussFinding', () => {
    const onDiscussFinding = vi.fn()
    render(<QualityReport {...props({ onDiscussFinding })} />)

    // Checks start collapsed, so no Discuss action is shown yet.
    expect(screen.queryByRole('button', { name: /discuss/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /authority/i }))

    const discuss = screen.getByRole('button', { name: /discuss/i })
    fireEvent.click(discuss)

    expect(onDiscussFinding).toHaveBeenCalledTimes(1)
    expect(onDiscussFinding.mock.calls[0]?.[0]?.id).toBe('authority')
  })

  it('shows a loading state and hides the stale review cards while a re-run is in flight', async () => {
    let resolveRun: ((value: OrdinanceQualityRun) => void) | undefined
    mocks.startQualityReport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve
        }),
    )

    render(<QualityReport {...props()} />)
    // The previous report is on screen before the re-run.
    expect(screen.getByText('Conflicts with Chapter 12.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    // While the re-run is in flight the stale cards and tally are replaced by a
    // loading state, so the user never stares at results that are being redone.
    expect(await screen.findByText(/reviewing the draft/i)).toBeVisible()
    expect(screen.queryByText('Conflicts with Chapter 12.')).toBeNull()
    expect(screen.queryByText('4 pass')).toBeNull()

    // Resolving with a fresh report swaps in the new results.
    resolveRun?.(
      qualityRun({
        report: report({ tally: { pass: 6, flag: 0, attention: 0 } }),
      }),
    )

    expect(await screen.findByText('6 pass')).toBeVisible()
    expect(screen.queryByText(/reviewing the draft/i)).toBeNull()
  })

  it('shows the loading state immediately on click — before the save flush or request resolve', () => {
    // A flush that never settles, so if the loading state were gated behind the
    // flush (or behind the request starting) it would not appear yet.
    const onBeforeRun = vi.fn(() => new Promise<void>(() => undefined))
    mocks.startQualityReport.mockImplementation(
      () => new Promise(() => undefined),
    )

    render(<QualityReport {...props({ onBeforeRun })} />)
    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    // Synchronously after the click: loading is up, stale cards are gone, and
    // the request hasn't even been made (the flush is still pending).
    expect(screen.getByText(/reviewing the draft/i)).toBeVisible()
    expect(screen.queryByText('Conflicts with Chapter 12.')).toBeNull()
    expect(mocks.startQualityReport).not.toHaveBeenCalled()
  })

  it('polls an accepted run every 2s and renders the report when it completes', async () => {
    vi.useFakeTimers()
    try {
      const onReran = vi.fn()
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running', error: null }),
      )
      mocks.fetchQualityRun
        .mockResolvedValueOnce(qualityRun({ status: 'running' }))
        .mockResolvedValueOnce(
          qualityRun({
            report: report({ tally: { pass: 6, flag: 0, attention: 0 } }),
          }),
        )

      render(<QualityReport {...props({ onReran })} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))
      await act(() => Promise.resolve())

      // The POST resolved 'running'; nothing has been polled yet.
      expect(screen.getByText(/reviewing the draft/i)).toBeVisible()
      expect(mocks.fetchQualityRun).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/reviewing the draft/i)).toBeVisible()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(2)
      expect(screen.getByText('6 pass')).toBeVisible()
      expect(screen.queryByText(/reviewing the draft/i)).toBeNull()
      expect(onReran).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a poll error, restores the previous report, and re-enables Re-run', async () => {
    vi.useFakeTimers()
    try {
      const onReran = vi.fn()
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun.mockResolvedValue(
        qualityRun({ status: 'error', error: 'The quality check hit a snag.' }),
      )

      render(<QualityReport {...props({ onReran })} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      expect(screen.getByText('The quality check hit a snag.')).toBeVisible()
      // The previous report is restored rather than lost.
      expect(screen.getByText('Conflicts with Chapter 12.')).toBeVisible()
      expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
      expect(screen.getByRole('button', { name: /re-run/i })).toBeEnabled()
      expect(onReran).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces the interrupted-run message when the server heals a dead run', async () => {
    vi.useFakeTimers()
    try {
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun
        .mockResolvedValueOnce(qualityRun({ status: 'running' }))
        .mockResolvedValueOnce(
          qualityRun({
            status: 'error',
            error: 'The last run was interrupted. Please try again.',
          }),
        )

      render(<QualityReport {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000)
      })

      expect(screen.getByText(/the last run was interrupted/i)).toBeVisible()
      expect(screen.getByRole('button', { name: /re-run/i })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes a running check on mount and polls to completion without a click', async () => {
    vi.useFakeTimers()
    try {
      const onReran = vi.fn()
      mocks.fetchQualityRun.mockResolvedValue(
        qualityRun({
          report: report({ tally: { pass: 6, flag: 0, attention: 0 } }),
        }),
      )

      render(
        <QualityReport {...props({ initialRunStatus: 'running', onReran })} />,
      )

      // Mounted straight into the loading state — no click, no new POST.
      expect(screen.getByText(/reviewing the draft/i)).toBeVisible()
      expect(mocks.startQualityReport).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(1)
      expect(screen.getByText('6 pass')).toBeVisible()
      expect(onReran).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops polling on unmount', async () => {
    vi.useFakeTimers()
    try {
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun.mockResolvedValue(qualityRun({ status: 'running' }))

      const { unmount } = render(<QualityReport {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(1)

      unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps polling through up to three consecutive poll failures', async () => {
    vi.useFakeTimers()
    try {
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun
        .mockRejectedValueOnce(new Error('net'))
        .mockRejectedValueOnce(new Error('net'))
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValueOnce(
          qualityRun({
            report: report({ tally: { pass: 6, flag: 0, attention: 0 } }),
          }),
        )

      render(<QualityReport {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000)
      })

      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(4)
      expect(screen.getByText('6 pass')).toBeVisible()
      expect(screen.queryByText(/could not run the quality checks/i)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces the standard error after a fourth consecutive poll failure', async () => {
    vi.useFakeTimers()
    try {
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun.mockRejectedValue(new Error('net'))

      render(<QualityReport {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000)
      })

      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(4)
      expect(
        screen.getByText(/could not run the quality checks/i),
      ).toBeVisible()
      // The previous report is restored and the button is usable again.
      expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
      expect(screen.getByRole('button', { name: /re-run/i })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Design contract (Lovable QualityReport): the panel's only control is a
  // refresh that re-grades the draft via the async claim-and-poll run. The
  // improvement loop has NO manual panel trigger — it auto-starts on draft.
  it('re-runs the manual check from the header refresh — no loop trigger', async () => {
    mocks.startQualityReport.mockResolvedValue(qualityRun())

    render(<QualityReport {...props()} />)

    expect(
      screen.queryByRole('button', { name: /check & improve/i }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    await act(() => Promise.resolve())
    expect(mocks.startQualityReport).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh while the background loop is running', () => {
    render(<QualityReport {...props({ loopRunning: true })} />)

    expect(screen.getByRole('button', { name: /re-run/i })).toBeDisabled()
  })

  it('disables the empty-state run while the background loop is running', () => {
    render(
      <QualityReport {...props({ initialReport: null, loopRunning: true })} />,
    )

    expect(
      screen.getByRole('button', { name: /run quality checks/i }),
    ).toBeDisabled()
  })

  it('runs the manual claim-and-poll from the empty state', async () => {
    mocks.startQualityReport.mockResolvedValue(qualityRun())

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(mocks.startQualityReport).toHaveBeenCalledTimes(1)
  })

  it('shows a softer note and slows polling after three minutes of running', async () => {
    vi.useFakeTimers()
    try {
      mocks.startQualityReport.mockResolvedValue(
        qualityRun({ status: 'running' }),
      )
      mocks.fetchQualityRun.mockResolvedValue(qualityRun({ status: 'running' }))

      render(<QualityReport {...props()} />)
      fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000)
      })

      // 2s cadence up to the threshold: 90 polls in 180s.
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(90)
      expect(screen.getByText(/still working/i)).toBeVisible()

      // Past the threshold the cadence slows to 10s — 2s more produces no poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(90)

      mocks.fetchQualityRun.mockResolvedValue(
        qualityRun({
          report: report({ tally: { pass: 6, flag: 0, attention: 0 } }),
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000)
      })
      expect(mocks.fetchQualityRun).toHaveBeenCalledTimes(91)
      expect(screen.getByText('6 pass')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })
})
