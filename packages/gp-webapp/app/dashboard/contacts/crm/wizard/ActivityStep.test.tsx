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

describe('ActivityStep — campaign picker filtering (completed + channel)', () => {
  it('offers only completed outreaches of the selected channel', async () => {
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
    // The trigger already shows "Any text campaign" as the default selected
    // value before opening — assert that first, then open the listbox to
    // check which specific outreaches are offered alongside it.
    expect(screen.getByText('Any text campaign')).toBeInTheDocument()
    await user.click(await screen.findByRole('combobox'))

    expect(
      await screen.findByRole('option', { name: 'GOTV blast' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'Not yet sent' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'Robo reminder' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Any text campaign' }),
    ).toBeInTheDocument()
  })

  it('hides the specific-campaign select entirely for door-knocking rows', async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Door Knocking' }))

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Answered')).toBeInTheDocument()
  })

  it('skips the GET /outreach fetch entirely in Serve mode and renders an empty picker', async () => {
    setWinContext(false)
    const outreachRequest = vi.fn()
    api.mock('GET /v1/outreach', () => {
      outreachRequest()
      return { status: 200, data: [] }
    })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('combobox'))

    expect(
      await screen.findByRole('option', { name: 'Any text campaign' }),
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
    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByText('GOTV blast'))
    await user.click(screen.getByText('Responded'))

    expect(lastConditions[0]?.outreachId).toBe(7)
    expect(lastConditions[0]?.actions).toEqual(['responded'])

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))

    expect(lastConditions[0]?.outreachType).toBe('robocall')
    expect(lastConditions[0]?.outreachId).toBeNull()
    expect(lastConditions[0]?.actions).toEqual([])
  })

  it("shows only the channel's outcome vocabulary and the empty-selection helper text", async () => {
    setWinContext(true)
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    const user = userEvent.setup()

    render(<ActivityStepHarness />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))

    expect(screen.getByText('Answered')).toBeInTheDocument()
    expect(screen.getByText('Voicemail Left')).toBeInTheDocument()
    expect(screen.getByText('No Answer')).toBeInTheDocument()
    expect(screen.queryByText('Not Home')).not.toBeInTheDocument()
    expect(
      screen.getByText(/everyone reached through this outreach/i),
    ).toBeInTheDocument()
  })
})

describe('toActivityConditionPayload / isActivityStepValid', () => {
  it('drops rows with no channel selected and maps the rest to the API shape', () => {
    const conditions: WizardActivityCondition[] = [
      {
        key: 'a',
        outreachType: 'text',
        outreachId: 5,
        actions: ['no_response'],
      },
      { key: 'b', outreachType: '', outreachId: null, actions: [] },
      {
        key: 'c',
        outreachType: 'doorKnocking',
        outreachId: null,
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
        { key: 'a', outreachType: '', outreachId: null, actions: [] },
      ]),
    ).toBe(false)
    expect(
      isActivityStepValid([
        { key: 'a', outreachType: 'text', outreachId: null, actions: [] },
      ]),
    ).toBe(true)
  })
})
