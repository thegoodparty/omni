import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import type { SegmentResponse } from '../shared/contacts-types'
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
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)

type ContextValue = ReturnType<typeof useContactsTable>

const refreshCustomSegments = vi.fn().mockResolvedValue(undefined)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
const selectList = vi.fn()

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isElectedOfficial: false,
    isWinContext: true,
    isWinContextReady: true,
    refreshCustomSegments,
    selectList,
    customSegments: [],
    ...overrides,
  } as ContextValue)
}

const pillForOption = (label: string): HTMLElement =>
  screen.getByRole('button', { name: label })

// Same gate as the create flow's Save: the CTA settles once the live count for
// the current selection lands, and stays enabled after (no trailing refetch
// re-disables it), so wait-then-click is race-free. 10s because each pill
// toggle restarts the count's 600ms debounce.
const clickSaveChanges = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  const save = await screen.findByRole('button', { name: /save changes/i })
  await vi.waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })
  await user.click(save)
}

// The render helper owns its QueryClient, so observe invalidation on the
// prototype rather than reaching for the instance.
const invalidatedKeys: unknown[] = []

const eventCalls = (event: string) =>
  vi.mocked(trackEvent).mock.calls.filter(([name]) => name === event)

// A voter-file list: one party pill, one gender pill, plus the persisted
// `false` for every other key (which is what the create path writes).
const voterFileSegment: SegmentResponse = {
  id: 42,
  name: 'Likely Dem women',
  partyDemocrat: true,
  partyRepublican: false,
  genderFemale: true,
  genderMale: false,
  languageCodes: ['es'],
  incomeRanges: ['$50k - $75k'],
  incomeUnknown: false,
  supportStatus: ['supporter'],
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  invalidatedKeys.length = 0
  vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation(
    (filters?: { queryKey?: unknown }) => {
      if (filters?.queryKey) invalidatedKeys.push(filters.queryKey)
      return Promise.resolve()
    },
  )
  refreshCustomSegments.mockClear()
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
  api.mock('GET /v1/contacts/precincts', {
    status: 200,
    data: { options: [], truncated: false },
  })
})

describe('CreateListWizard — edit mode chrome', () => {
  it('opens on the conditions step with no branch chooser, stepper, or Back', async () => {
    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Filters' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Edit list')).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/step 1 of/i)).not.toBeInTheDocument()
  })

  it('puts the list name in the header, so edit covers renaming with no second step', async () => {
    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    expect(await screen.findByLabelText('List name')).toHaveValue(
      'Likely Dem women',
    )
    expect(
      screen.queryByRole('button', { name: 'Save list' }),
    ).not.toBeInTheDocument()
  })

  it('seeds every pill the saved list was built from, including language and income', async () => {
    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    expect(pillForOption('Democrat')).toHaveAttribute('data-state', 'on')
    expect(pillForOption('Female')).toHaveAttribute('data-state', 'on')
    expect(pillForOption('Spanish')).toHaveAttribute('data-state', 'on')
    expect(pillForOption('$50k - $75k')).toHaveAttribute('data-state', 'on')
    expect(pillForOption('Republican')).toHaveAttribute('data-state', 'off')
    expect(pillForOption('Supporter')).toHaveAttribute('data-state', 'on')
  })

  it('opens on the activity step for a list built from outreach activity', async () => {
    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{
          id: 43,
          name: 'Texted, no reply',
          activityConditions: [
            { outreachType: 'text', outreachId: null, actions: ['responded'] },
          ],
        }}
      />,
    )

    // Both steps render a "Filters" heading, so the branch shows in the
    // controls: the activity chip rows, and none of the demographic pills.
    expect(await screen.findByText('Previous activity')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Democrat' }),
    ).not.toBeInTheDocument()
  })

  // `open` is a derived OR of the page's create button and the provider's
  // editingSegment, so a switch between them never passes through `false` —
  // an effect watching `open` alone would leave the previous list seeded under
  // create-mode chrome.
  it('reseeds when the wizard switches from editing to creating without closing', async () => {
    const { rerender } = render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    expect(pillForOption('Democrat')).toHaveAttribute('data-state', 'on')

    rerender(<CreateListWizard open onOpenChange={vi.fn()} />)

    expect(
      await screen.findByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('List name')).not.toBeInTheDocument()
  })

  it('reseeds when the wizard switches straight from one list to another', async () => {
    const { rerender } = render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    expect(pillForOption('Democrat')).toHaveAttribute('data-state', 'on')

    rerender(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{ id: 99, name: 'Republicans', partyRepublican: true }}
      />,
    )

    await vi.waitFor(() =>
      expect(screen.getByLabelText('List name')).toHaveValue('Republicans'),
    )
    expect(pillForOption('Republican')).toHaveAttribute('data-state', 'on')
    expect(pillForOption('Democrat')).toHaveAttribute('data-state', 'off')
  })

  // The overlap union counts the list being edited among the org's saved
  // lists, so an untouched selection would report ~100% already-saved.
  it('hides the saved-list overlap strip', async () => {
    api.mock('POST /v1/contacts/overlap-count', {
      status: 200,
      data: { count: 250 },
    })
    setContext({ customSegments: [voterFileSegment] })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    expect(
      screen.queryByText(/already exist in lists/i),
    ).not.toBeInTheDocument()
  })
})

describe('CreateListWizard — edit mode save', () => {
  it('PUTs the edited criteria and lands back on the list detail sheet', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 42, name: 'Likely Dem women' } }
    })
    const onOpenChange = vi.fn()

    render(
      <CreateListWizard
        open
        onOpenChange={onOpenChange}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await user.click(pillForOption('Republican'))
    await clickSaveChanges(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Likely Dem women',
      partyDemocrat: true,
      partyRepublican: true,
      genderFemale: true,
      languageCodes: ['es'],
      incomeRanges: ['$50k - $75k'],
      supportStatus: ['supporter'],
    })

    await vi.waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('List updated'),
    )
    await vi.waitFor(() => expect(refreshCustomSegments).toHaveBeenCalled())
    await vi.waitFor(() => expect(selectList).toHaveBeenCalledWith(42))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // The persisted shape carries an explicit boolean per key — sending only the
  // selected ones would make a filter impossible to remove.
  it('clears a deselected filter by sending it as false', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 42 } }
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await user.click(pillForOption('Democrat'))
    await clickSaveChanges(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({ partyDemocrat: false })
  })

  // ENG-10752's retired age buckets can't be rendered or counted, so an edit
  // that left them set would save a list narrower than the count on its own
  // Save button.
  it('drops the retired age columns a legacy list still carries', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 44 } }
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{
          id: 44,
          name: 'Legacy age list',
          age18_25: true,
          age50Plus: true,
          partyDemocrat: true,
        }}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await clickSaveChanges(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      age18_25: false,
      age50Plus: false,
      partyDemocrat: true,
    })
  })

  // A list saved from a search keeps filtering on that term server-side, so
  // omitting it would preview a wider audience than the list actually holds.
  it("carries a saved list's search term into the count and the save", async () => {
    const user = userEvent.setup()
    let countBody: Record<string, unknown> | null = null
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/contacts/count', ({ body }) => {
      countBody = body as Record<string, unknown>
      return { status: 200, data: { count: 250 } }
    })
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 45 } }
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{
          id: 45,
          name: 'Martinez supporters',
          partyDemocrat: true,
          search: 'martinez',
        }}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await clickSaveChanges(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(countBody).toMatchObject({ search: 'martinez' })
    expect(sentBody).toMatchObject({ search: 'martinez' })
  })

  it('renames without touching the filters', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 42, name: 'Renamed' } }
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    const nameInput = await screen.findByLabelText('List name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed')
    await clickSaveChanges(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Renamed',
      partyDemocrat: true,
      genderFemale: true,
    })
  })

  it('blocks the save when the name is cleared', async () => {
    const user = userEvent.setup()

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    const save = await screen.findByRole('button', { name: /save changes/i })
    await vi.waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })

    await user.clear(await screen.findByLabelText('List name'))
    expect(save).toBeDisabled()
  })

  it('blocks the save once every filter is deselected', async () => {
    const user = userEvent.setup()

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{ id: 46, name: 'One filter', partyDemocrat: true }}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    const save = await screen.findByRole('button', { name: /save changes/i })
    await vi.waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })

    await user.click(pillForOption('Democrat'))
    await vi.waitFor(() => expect(save).toBeDisabled())
  })

  // refreshCustomSegments refetches rather than invalidating, so a failed
  // refetch would otherwise leave the index showing the pre-edit list.
  it('marks the segments cache stale when the post-save refresh fails', async () => {
    const user = userEvent.setup()
    refreshCustomSegments.mockRejectedValueOnce(new Error('network'))
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: { id: 42 },
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await clickSaveChanges(user)

    await vi.waitFor(() =>
      expect(successSnackbar).toHaveBeenCalledWith('List updated'),
    )
    expect(invalidatedKeys).toContainEqual(['custom-segments', 'test-org'])
  })

  it('fires Segment Updated with action filters on a successful save only', async () => {
    const user = userEvent.setup()
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 500,
      data: { message: 'server exploded' },
    })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await clickSaveChanges(user)
    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to update list'),
    )
    expect(eventCalls(EVENTS.Contacts.SegmentUpdated)).toHaveLength(0)

    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: { id: 42 },
    })
    await clickSaveChanges(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.SegmentUpdated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.SegmentUpdated, {
      action: 'filters',
      context: 'win',
    })
  })

  // ENG-10703 stamps firstUsedForOutreachAt atomically, so a list can lock
  // while this sheet is open.
  it('raced 409: locked message, sheet closes, no generic failure toast', async () => {
    const user = userEvent.setup()
    // api.mock's typed status union doesn't include 409, so this drops to the
    // raw mswServer rather than widening that union.
    mswServer.use(
      http.put('/api/v1/voters/voter-file/filter/:id', () =>
        HttpResponse.json(
          { statusCode: 409, message: LOCKED_LIST_MESSAGE, error: 'Conflict' },
          { status: 409 },
        ),
      ),
    )
    const onOpenChange = vi.fn()

    render(
      <CreateListWizard
        open
        onOpenChange={onOpenChange}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    await clickSaveChanges(user)

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(LOCKED_LIST_MESSAGE, {
        autoHideDuration: 6000,
      }),
    )
    await vi.waitFor(() => expect(refreshCustomSegments).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(errorSnackbar).not.toHaveBeenCalledWith('Failed to update list')
  })

  // The create funnel's stages are a create metric — an edit reuses the
  // conditions screen but can never reach Name Completed.
  it('fires no create-funnel stage events', async () => {
    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={voterFileSegment}
      />,
    )

    await screen.findByRole('heading', { name: 'Filters' })
    expect(
      eventCalls(EVENTS.Contacts.ListWizard.ConditionsViewed),
    ).toHaveLength(0)
  })
})
