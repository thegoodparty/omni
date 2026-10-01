import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  PRIORITY_STEP_PURPOSE,
  emptyPriorityStatus,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { PriorityStatusRail } from './PriorityStatusRail'

const withStep = (
  id: PriorityStepId,
  patch: {
    state: PriorityStepState
    summary?: string
    caveat?: string
    check?: PriorityStep['check']
  },
): PriorityStatus => {
  const base = emptyPriorityStatus()
  return {
    ...base,
    steps: base.steps.map((step) =>
      step.id === id ? { ...step, ...patch } : step,
    ),
  }
}

describe('PriorityStatusRail', () => {
  it('renders all seven steps with the labels from the contract', () => {
    render(
      <PriorityStatusRail status={emptyPriorityStatus()} nextAction={null} />,
    )
    expect(PRIORITY_STEP_IDS).toHaveLength(7)
    for (const id of PRIORITY_STEP_IDS) {
      expect(
        screen.getByRole('button', {
          name: new RegExp(PRIORITY_STEP_LABELS[id], 'i'),
        }),
      ).toBeInTheDocument()
    }
  })

  it('distinguishes a stale step from a settled one', () => {
    const status: PriorityStatus = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((step) => {
        if (step.id === 'evidence') return { ...step, state: 'settled' }
        if (step.id === 'listen_options') return { ...step, state: 'stale' }
        return step
      }),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)

    const settledRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.evidence, 'i'),
    })
    const staleRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.listen_options, 'i'),
    })
    expect(within(settledRow).getByText('Done')).toBeInTheDocument()
    expect(within(staleRow).getByText('Needs another look')).toBeInTheDocument()
    expect(within(staleRow).queryByText('Done')).not.toBeInTheDocument()
  })

  it('counts only settled steps', () => {
    render(
      <PriorityStatusRail
        status={withStep('evidence', { state: 'settled' })}
        nextAction={null}
      />,
    )
    expect(screen.getByText('1 of 7 done')).toBeInTheDocument()
  })

  it('keeps a settled gate in progress until its check has gone out', () => {
    const asked = withStep('define', {
      state: 'settled',
      check: { state: 'asked', who: '', question: '', raised: 0 },
    })
    const { unmount } = render(
      <PriorityStatusRail status={asked} nextAction={null} />,
    )
    const row = () =>
      screen.getByRole('button', {
        name: new RegExp(PRIORITY_STEP_LABELS.define, 'i'),
      })
    expect(within(row()).getByText('Working on it')).toBeInTheDocument()
    expect(screen.getByText('0 of 7 done')).toBeInTheDocument()
    unmount()

    render(
      <PriorityStatusRail
        status={withStep('define', {
          state: 'settled',
          check: { state: 'out', who: '', question: '', raised: 0 },
        })}
        nextAction={null}
      />,
    )
    expect(within(row()).getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('1 of 7 done')).toBeInTheDocument()
  })

  it('opens a step to show its summary and its caveat', async () => {
    const user = userEvent.setup()
    render(
      <PriorityStatusRail
        status={withStep('evidence', {
          state: 'stale',
          summary: 'Three of eight blocks flood.',
          caveat: 'The drainage report contradicts the count.',
        })}
        nextAction={null}
      />,
    )
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(PRIORITY_STEP_LABELS.evidence, 'i'),
      }),
    )
    expect(screen.getByText('Three of eight blocks flood.')).toBeInTheDocument()
    expect(screen.getByText(PRIORITY_STEP_PURPOSE.evidence)).toBeInTheDocument()
    expect(
      screen.getByText('The drainage report contradicts the count.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /all steps/i }))
    expect(
      screen.getByRole('button', {
        name: new RegExp(PRIORITY_STEP_LABELS.plan, 'i'),
      }),
    ).toBeInTheDocument()
  })

  it('says why a step exists only once it is open', async () => {
    const user = userEvent.setup()
    render(
      <PriorityStatusRail status={emptyPriorityStatus()} nextAction={null} />,
    )
    expect(
      screen.queryByText(PRIORITY_STEP_PURPOSE.define),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(PRIORITY_STEP_LABELS.define, 'i'),
      }),
    )
    expect(screen.getByText(PRIORITY_STEP_PURPOSE.define)).toBeInTheDocument()
  })

  it('says whether a step has been checked with constituents', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) => {
        if (step.id === 'define') {
          return {
            ...step,
            state: 'settled',
            check: { state: 'deferred', who: '', question: '', raised: 0 },
          }
        }
        if (step.id === 'options') {
          return {
            ...step,
            state: 'settled',
            check: {
              state: 'confirmed',
              who: '',
              question: '',
              raised: 0,
              contrast: { state: 'declined', who: '', question: '' },
            },
          }
        }
        return step
      }),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)

    const defineRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.define, 'i'),
    })
    const optionsRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.options, 'i'),
    })
    const evidenceRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.evidence, 'i'),
    })
    expect(
      within(defineRow).getByText('Checking with constituents later'),
    ).toBeInTheDocument()
    expect(
      within(optionsRow).getByText('Constituents agreed'),
    ).toBeInTheDocument()
    expect(within(optionsRow).queryByText(/least affected/i)).toBeNull()
    expect(within(defineRow).queryByText(/least affected/i)).toBeNull()
    expect(within(evidenceRow).queryByText(/constituents/i)).toBeNull()
    expect(defineRow).toHaveAccessibleName(
      new RegExp(`^${PRIORITY_STEP_LABELS.define}\\s+\\S`),
    )
    expect(defineRow).not.toHaveAccessibleName(/constituents/i)
    expect(defineRow).toHaveAccessibleDescription(
      'Checking with constituents later',
    )
    expect(evidenceRow).not.toHaveAttribute('aria-describedby')
  })

  it('says an offered check is waiting on the official', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'define'
          ? {
              ...step,
              state: 'settled',
              check: { state: 'asked', who: '', question: '', raised: 0 },
            }
          : step,
      ),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)
    expect(
      screen.getByText('Waiting on you: check with constituents'),
    ).toBeInTheDocument()
  })

  it('says once that a check is waiting, whichever side it is', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'define'
          ? {
              ...step,
              state: 'settled',
              check: {
                state: 'asked',
                who: '',
                question: '',
                raised: 0,
                contrast: { state: 'asked', who: '', question: '' },
              },
            }
          : step,
      ),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)
    expect(
      screen.getAllByText('Waiting on you: check with constituents'),
    ).toHaveLength(1)
    expect(screen.queryByText(/least affected/i)).toBeNull()
  })

  it('leads with the main side once it is out with people', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'define'
          ? {
              ...step,
              state: 'settled',
              check: {
                state: 'out',
                who: '',
                question: '',
                raised: 0,
                contrast: { state: 'asked', who: '', question: '' },
              },
            }
          : step,
      ),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)
    const defineRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.define, 'i'),
    })
    expect(
      within(defineRow).getByText('Waiting to hear back'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/waiting on you/i)).toBeNull()
  })

  it('shows who to hear from waiting while the check is out', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'define'
          ? {
              ...step,
              state: 'settled',
              check: { state: 'out', who: '', question: '', raised: 0 },
            }
          : step,
      ),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)
    const listenRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.listen_problem, 'i'),
    })
    expect(
      within(listenRow).getByText('Waiting to hear back'),
    ).toBeInTheDocument()
  })

  it('keeps work past an open listening step in progress, and says why', () => {
    const base = emptyPriorityStatus()
    const status: PriorityStatus = {
      ...base,
      steps: base.steps.map((step) => {
        if (step.id === 'define') {
          return {
            ...step,
            state: 'settled',
            check: { state: 'declined', who: '', question: '', raised: 0 },
          }
        }
        if (step.id === 'evidence') return { ...step, state: 'settled' }
        if (step.id === 'options') {
          return {
            ...step,
            state: 'settled',
            check: { state: 'out', who: '', question: '', raised: 0 },
          }
        }
        return step
      }),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)
    const row = (id: PriorityStepId) =>
      screen.getByRole('button', {
        name: new RegExp(PRIORITY_STEP_LABELS[id], 'i'),
      })
    expect(
      within(row('listen_problem')).getByText('Not started'),
    ).toBeInTheDocument()
    expect(
      within(row('options')).getByText('Working on it'),
    ).toBeInTheDocument()
    expect(screen.getByText('2 of 7 done')).toBeInTheDocument()
  })

  it('says the listening step is waiting on the check going out', () => {
    render(
      <PriorityStatusRail
        status={withStep('define', {
          state: 'settled',
          check: { state: 'asked', who: '', question: '', raised: 0 },
        })}
        nextAction={null}
      />,
    )
    expect(
      within(
        screen.getByRole('button', {
          name: new RegExp(PRIORITY_STEP_LABELS.listen_problem, 'i'),
        }),
      ).getByText('Waiting on the check to go out'),
    ).toBeInTheDocument()
  })

  it('shows the next action when there is one', () => {
    render(
      <PriorityStatusRail
        status={emptyPriorityStatus()}
        nextAction="Pick two blocks to walk"
      />,
    )
    expect(screen.getByText('Pick two blocks to walk')).toBeInTheDocument()
  })
})
