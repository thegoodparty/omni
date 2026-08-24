import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import ActivityStep, {
  blankActivityCondition,
  isActivityStepValid,
  toActivityConditionPayload,
  type WizardActivityCondition,
} from './ActivityStep'
import { useContactsTable } from '../ContactsTableProvider'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

const setWinContext = (isWinContext: boolean) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext,
  } as ReturnType<typeof useContactsTable>)
}

const outreach = (overrides: Partial<Outreach> = {}): Outreach => ({
  id: 1,
  campaignId: 1,
  outreachType: 'text',
  status: 'completed',
  name: 'GOTV blast',
  ...overrides,
})

// ActivityStep is fully controlled (conditions/onChange props) — a real
// stateful parent so interactions actually re-render, matching how
// CreateListWizard drives it in production.
let lastConditions: WizardActivityCondition[] = []
function ActivityStepHarness() {
  const [conditions, setConditions] = useState<WizardActivityCondition[]>(
    () => [blankActivityCondition()],
  )
  lastConditions = conditions
  return (
    <ActivityStep
      conditions={conditions}
      onChange={(next) => {
        setConditions(next)
        lastConditions = next
      }}
    />
  )
}

beforeEach(() => {
  api.reset()
})

describe('ActivityStep — campaign chip row (completed + channel)', () => {
  it('offers only completed outreaches of the selected channel, with "Any campaign" selected by default', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        outreach({
          id: 1,
          outreachType: 'text',
          status: 'completed',
          name: 'GOTV blast',
        }),
        outreach({
          id: 2,
          outreachType: 'text',
          status: 'pending',
          name: 'Not yet sent',
        }),
        outreach({
          id: 3,
          outreachType: 'robocall',
          status: 'completed',
          name: 'Robo reminder',
        }),
      ],
    })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))

    const anyCampaign = await screen.findByRole('radio', {
      name: 'Any campaign',
    })
    expect(anyCampaign).toHaveAttribute('data-state', 'on')
    expect(
      await screen.findByRole('radio', { name: 'GOTV blast' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'Not yet sent' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'Robo reminder' }),
    ).not.toBeInTheDocument()
  })

  it('offers a completed nativePhoneBanking outreach under the phoneBanking channel', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        outreach({
          id: 4,
          outreachType: 'nativePhoneBanking',
          status: 'completed',
          name: 'GOTV calls',
        }),
        outreach({
          id: 5,
          outreachType: 'nativePhoneBanking',
          status: 'in_progress',
          name: 'Still calling',
        }),
      ],
    })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Phone Banking' }))

    const anyCampaign = await screen.findByRole('radio', {
      name: 'Any campaign',
    })
    expect(anyCampaign).toHaveAttribute('data-state', 'on')
    expect(
      await screen.findByRole('radio', { name: 'GOTV calls' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'Still calling' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'GOTV calls' }))

    expect(lastConditions[0]?.outreachType).toBe('phoneBanking')
    expect(lastConditions[0]?.outreachId).toBe(4)
    expect(lastConditions[0]?.outreachName).toBe('GOTV calls')
  })

  it('hides the campaign row entirely for door-knocking rows', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Door Knocking' }))

    expect(
      screen.queryByRole('radio', { name: 'Any campaign' }),
    ).not.toBeInTheDocument()
  })

  it('skips the GET /outreach fetch entirely in Serve mode and still renders "Any campaign"', async () => {
    setWinContext(false)
    const outreachRequest = vi.fn()
    api.mock('GET /v1/outreach', () => {
      outreachRequest()
      return { status: 200, data: [] }
    })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))

    expect(
      await screen.findByRole('radio', { name: 'Any campaign' }),
    ).toBeInTheDocument()
    expect(outreachRequest).not.toHaveBeenCalled()
  })

  it("switching a row's channel clears the previously selected campaign and outcomes", async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [outreach({ id: 7, outreachType: 'text', status: 'completed' })],
    })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('radio', { name: 'GOTV blast' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('Responded'))

    expect(lastConditions[0]?.outreachId).toBe(7)
    expect(lastConditions[0]?.outreachName).toBe('GOTV blast')
    expect(lastConditions[0]?.actions).toEqual(['responded'])

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))

    expect(lastConditions[0]?.outreachType).toBe('robocall')
    expect(lastConditions[0]?.outreachId).toBeNull()
    expect(lastConditions[0]?.outreachName).toBeNull()
    expect(lastConditions[0]?.actions).toEqual([])
  })
})

describe('ActivityStep — progressive outcome reveal', () => {
  it('hides outcomes behind "Filter on activity" and reveals the channel vocabulary on click', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))

    expect(screen.queryByText('Answered')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))

    expect(screen.getByText('Answered')).toBeInTheDocument()
    expect(screen.getByText('Voicemail Left')).toBeInTheDocument()
    expect(screen.getByText('No Answer')).toBeInTheDocument()
    expect(screen.queryByText('Not Home')).not.toBeInTheDocument()
  })

  it('clears the outcome selection and re-hides the row via the remove-activity trash', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('Answered'))
    expect(lastConditions[0]?.actions).toEqual(['answered'])

    await user.click(
      screen.getByRole('button', { name: 'Remove activity filter' }),
    )

    expect(lastConditions[0]?.actions).toEqual([])
    expect(screen.queryByText('Answered')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Filter on activity' }),
    ).toBeInTheDocument()
  })

  it('disables the remove-condition trash when only one condition exists and resets via Clear filters', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    expect(
      screen.getByRole('button', { name: 'Remove condition 1' }),
    ).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    expect(lastConditions[0]?.outreachType).toBe('robocall')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(lastConditions).toHaveLength(1)
    expect(lastConditions[0]?.outreachType).toBe('')
  })
})

describe('toActivityConditionPayload / isActivityStepValid', () => {
  it('drops rows with no channel selected and maps the rest to the API shape', () => {
    const conditions: WizardActivityCondition[] = [
      {
        key: 'a',
        outreachType: 'text',
        outreachId: 5,
        outreachName: 'GOTV blast',
        actions: ['no_response'],
      },
      {
        key: 'b',
        outreachType: '',
        outreachId: null,
        outreachName: null,
        actions: [],
      },
      {
        key: 'c',
        outreachType: 'doorKnocking',
        outreachId: null,
        outreachName: null,
        actions: ['support_yes'],
      },
    ]

    expect(toActivityConditionPayload(conditions)).toEqual([
      { outreachType: 'text', outreachId: 5, actions: ['no_response'] },
      {
        outreachType: 'doorKnocking',
        outreachId: null,
        actions: ['support_yes'],
      },
    ])
  })

  it('is invalid when empty or when any row lacks a channel', () => {
    expect(isActivityStepValid([])).toBe(false)
    expect(
      isActivityStepValid([
        {
          key: 'a',
          outreachType: '',
          outreachId: null,
          outreachName: null,
          actions: [],
        },
      ]),
    ).toBe(false)
    expect(
      isActivityStepValid([
        {
          key: 'a',
          outreachType: 'text',
          outreachId: null,
          outreachName: null,
          actions: [],
        },
      ]),
    ).toBe(true)
  })
})
