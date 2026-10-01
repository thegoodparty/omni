import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  PRIORITY_STEP_PURPOSE,
  emptyPriorityStatus,
  type PriorityStatus,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { PriorityStatusRail } from './PriorityStatusRail'

const withStep = (
  id: PriorityStepId,
  patch: { state: PriorityStepState; summary?: string; caveat?: string },
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
        if (step.id === 'define') return { ...step, state: 'settled' }
        if (step.id === 'evidence') return { ...step, state: 'stale' }
        return step
      }),
    }
    render(<PriorityStatusRail status={status} nextAction={null} />)

    const settledRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.define, 'i'),
    })
    const staleRow = screen.getByRole('button', {
      name: new RegExp(PRIORITY_STEP_LABELS.evidence, 'i'),
    })
    expect(within(settledRow).getByText('Done')).toBeInTheDocument()
    expect(within(staleRow).getByText('Needs another look')).toBeInTheDocument()
    expect(within(staleRow).queryByText('Done')).not.toBeInTheDocument()
  })

  it('counts only settled steps', () => {
    render(
      <PriorityStatusRail
        status={withStep('define', { state: 'settled' })}
        nextAction={null}
      />,
    )
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
            check: { state: 'confirmed', who: '', question: '', raised: 0 },
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
    expect(within(evidenceRow).queryByText(/constituents/i)).toBeNull()
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
