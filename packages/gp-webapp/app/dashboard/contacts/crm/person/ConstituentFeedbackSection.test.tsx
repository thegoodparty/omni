import { beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { ConstituentFeedbackRecord } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ConstituentFeedbackSection } from './ConstituentFeedbackSection'

const feedback = (
  overrides: Partial<ConstituentFeedbackRecord>,
): ConstituentFeedbackRecord => ({
  id: 'feedback-1',
  personId: 'p_1',
  occurredAt: new Date('2026-10-02T00:00:00.000Z'),
  channel: 'door_knock',
  transcript: 'Thinks the levy is fine but wants the spending shown.',
  issues: [
    {
      id: 'issue-property-taxes',
      position: 0,
      issueLabel: 'Property taxes',
      stance: 'mixed',
      desiredOutcome: 'Show where the money goes',
    },
  ],
  extractionStatus: 'extracted',
  confirmedAt: new Date('2026-10-02T00:00:01.000Z'),
  outreachId: 7,
  actorName: 'Kamal Al Sawafi',
  tags: [],
  ...overrides,
})

const mockFeedback = (entries: ConstituentFeedbackRecord[]) =>
  api.mock('GET /v1/constituent-feedback', {
    status: 200,
    data: { feedback: entries },
  })

describe('ConstituentFeedbackSection', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // globals.css makes every <li> under the dashboard's data-slot shell a flex
  // row, which put the issue line and its Wants side by side ("MixedWants:")
  // on a computer. The item stacks its two lines whatever the width.
  it('stacks the position and what they want as two lines', async () => {
    mockFeedback([feedback({})])

    render(<ConstituentFeedbackSection personId="p_1" isServe />)

    const issues = await screen.findByRole('list', { name: 'Issues' })
    const [item] = within(issues).getAllByRole('listitem')
    expect(item).toHaveClass('flex', 'flex-col')

    const wants = within(item!).getByText('Wants: Show where the money goes')
    expect(wants.tagName).toBe('P')
    const stance = within(item!).getByText('· Mixed')
    expect(wants.contains(stance)).toBe(false)
    expect(stance.parentElement?.contains(wants)).toBe(false)
  })

  // A resident's own text reply to a priority, read for issues the way a
  // door memo is. Nobody on the office's side wrote it, and there is no
  // step where anyone checks it, so neither the owner it is filed under nor
  // "Not yet reviewed" is shown.
  it('shows a text reply as by text, credited to nobody', async () => {
    mockFeedback([
      feedback({
        channel: 'text',
        transcript: 'Only if they show where the money goes.',
        confirmedAt: null,
        outreachId: null,
        actorName: 'Office Owner',
      }),
    ])

    render(<ConstituentFeedbackSection personId="p_1" isServe />)

    expect(await screen.findByText('What they told us')).toBeInTheDocument()
    expect(screen.getByText('Property taxes')).toBeInTheDocument()
    expect(screen.getByText(/^By text · /)).toBeInTheDocument()
    expect(screen.queryByText(/Office Owner/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Not yet reviewed/)).not.toBeInTheDocument()
  })

  it('still marks an unreviewed door memo', async () => {
    mockFeedback([feedback({ confirmedAt: null })])

    render(<ConstituentFeedbackSection personId="p_1" isServe />)

    expect(
      await screen.findByText(/At the door · .* · Not yet reviewed/),
    ).toBeInTheDocument()
  })
})
