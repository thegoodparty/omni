import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import CreateListWizard from './CreateListWizard'
import { useContactsTable } from '../ContactsTableProvider'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)

type ContextValue = ReturnType<typeof useContactsTable>

const refreshCustomSegments = vi.fn().mockResolvedValue(undefined)
const selectSegment = vi.fn()
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isElectedOfficial: false,
    isWinContext: true,
    isWinContextReady: true,
    refreshCustomSegments,
    selectSegment,
    ...overrides,
  } as ContextValue)
}

beforeEach(() => {
  api.reset()
  refreshCustomSegments.mockClear()
  selectSegment.mockClear()
  successSnackbar.mockClear()
  errorSnackbar.mockClear()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
  setContext()
  api.mock('GET /v1/outreach', { status: 200, data: [] })
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 250 } })
})

describe('CreateListWizard — step navigation', () => {
  it('disables Next on step 1 until a branch is chosen', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    expect(next).toBeEnabled()
  })

  it('advances to the voter-file step 2 and back to step 1', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      screen.getByRole('heading', { name: /general information/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    ).toBeInTheDocument()
  })

  it('advances to the activity step 2 and disables Next until every row has a channel', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from outreach activity/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    expect(next).toBeEnabled()
  })

  it('resets all state when reopened after being cancelled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <CreateListWizard open onOpenChange={onOpenChange} />,
    )

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    rerender(<CreateListWizard open={false} onOpenChange={onOpenChange} />)
    rerender(<CreateListWizard open onOpenChange={onOpenChange} />)

    expect(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    ).toBeInTheDocument()
  })
})

describe('CreateListWizard — voter-file branch payload assembly', () => {
  it('sends the exact demographic + support-status request body', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 101, name: 'Likely Dem women' } }
    })
    const onOpenChange = vi.fn()

    render(<CreateListWizard open onOpenChange={onOpenChange} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Mirrors FiltersSheet.test.tsx's checkboxForOption helper: the label is
    // a sibling of the checkbox (not a wrapping <label>), so find the row
    // then the checkbox within it.
    const checkboxForOption = (label: string): HTMLElement => {
      const labelNode = screen.getByText(new RegExp(`^${label}$`, 'i'))
      const row = labelNode.parentElement
      if (!row) throw new Error(`row for ${label} not found`)
      return within(row).getByRole('checkbox')
    }

    await user.click(checkboxForOption('Female'))
    await user.click(checkboxForOption('Democrat'))
    await user.click(checkboxForOption('Supporter'))

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText(/list name/i), 'Likely Dem women')
    await user.click(screen.getByRole('button', { name: /build your list/i }))

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Likely Dem women',
      genderFemale: true,
      partyDemocrat: true,
      supportStatus: ['supporter'],
    })
    expect(sentBody).not.toHaveProperty('activityConditions')

    await vi.waitFor(() => expect(refreshCustomSegments).toHaveBeenCalled())
    expect(selectSegment).toHaveBeenCalledWith('101')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hides the Political Party section for an elected official', async () => {
    setContext({ isElectedOfficial: true })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      screen.queryByRole('heading', { name: /political party/i }),
    ).not.toBeInTheDocument()
  })
})

describe('CreateListWizard — activity branch payload assembly', () => {
  it('fires no count request while the activity selection is incomplete', async () => {
    const countHandler = vi.fn(() => ({
      status: 200 as const,
      data: { count: 250 },
    }))
    api.mock('POST /v1/contacts/count', countHandler)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from outreach activity/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // An incomplete condition serializes to activityConditions: [] — the
    // backend would return the unfiltered total and poison the count cache.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(countHandler).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await vi.waitFor(() => expect(countHandler).toHaveBeenCalled())
  })

  it('sends two stacked conditions in the exact API shape (AC example)', async () => {
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        {
          id: 55,
          campaignId: 1,
          outreachType: 'text',
          status: 'completed',
          name: 'GOTV blast',
        },
      ],
    })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 202, name: 'Text + door knock' } }
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from outreach activity/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Condition 1: text · GOTV blast · no response
    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByText('GOTV blast'))
    await user.click(screen.getByText('No Response'))

    // Condition 2: door knocking · any · support yes
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    const doorKnockRadios = screen.getAllByRole('radio', {
      name: 'Door Knocking',
    })
    await user.click(doorKnockRadios[doorKnockRadios.length - 1]!)
    await user.click(screen.getByText('Support: Yes'))

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeEnabled()
    await user.click(next)
    await user.type(screen.getByLabelText(/list name/i), 'Text + door knock')
    await user.click(screen.getByRole('button', { name: /build your list/i }))

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Text + door knock',
      activityConditions: [
        { outreachType: 'text', outreachId: 55, actions: ['no_response'] },
        {
          outreachType: 'doorKnocking',
          outreachId: null,
          actions: ['support_yes'],
        },
      ],
    })
    expect(sentBody).not.toHaveProperty('supportStatus')
  })
})

describe('CreateListWizard — running total + build button', () => {
  it('shows the debounced count and reads it on the build button', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/250 voters match/i)).toBeInTheDocument()
  })

  it('surfaces the 100k-cap error as guidance rather than a crash', async () => {
    api.mock('POST /v1/contacts/count', {
      status: 400,
      data: {
        message: 'This filter resolves too many people to apply directly',
      },
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/too many people/i)).toBeInTheDocument()
    // The build button must still be usable once named — the cap is
    // guidance, not a hard submit-block (the create endpoint doesn't
    // resolve/cap at save time).
    await user.type(screen.getByLabelText(/list name/i), 'Huge list')
    expect(
      screen.getByRole('button', { name: /build your list/i }),
    ).toBeEnabled()
  })
})

describe('CreateListWizard — error handling', () => {
  it('shows an error snackbar and keeps the wizard open when create fails', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<CreateListWizard open onOpenChange={onOpenChange} />)

    await user.click(
      screen.getByRole('radio', { name: /build from the voter file/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText(/list name/i), 'Broken list')
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )

    await vi.waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
