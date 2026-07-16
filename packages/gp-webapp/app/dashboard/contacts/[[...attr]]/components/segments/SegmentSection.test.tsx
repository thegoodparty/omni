import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import SegmentSection from './SegmentSection'
import { useContactsTable } from '../../../crm/ContactsTableProvider'
import { useShowContactProModal } from '../../../crm/ContactProModal'
import { useSnackbar } from 'helpers/useSnackbar'

vi.mock('../../../crm/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))

vi.mock('../../../crm/ContactProModal', () => ({
  useShowContactProModal: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-one' }),
}))

vi.mock('helpers/analyticsHelper', async () => {
  const actual = await vi.importActual<object>('helpers/analyticsHelper')
  return {
    ...actual,
    trackEvent: vi.fn(),
  }
})

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseShowContactProModal = vi.mocked(useShowContactProModal)

type ContextValue = ReturnType<typeof useContactsTable>

const CUSTOM_SEGMENT = { id: 7, name: 'Independent women', search: null }

function setContext(overrides: Partial<ContextValue> = {}) {
  const ctx: ContextValue = {
    filteredContacts: [],
    currentlySelectedPersonId: null,
    currentlySelectedPerson: {
      person: null,
      isLoadingPerson: false,
      isErrorPerson: false,
      issues: [],
      isLoadingIssues: false,
      isErrorIssues: false,
      issuesHasNextPage: false,
      issuesFetchNextPage: vi.fn(),
      isFetchingNextIssues: false,
      activities: [],
      isLoadingActivities: false,
      isErrorActivities: false,
      activitiesHasNextPage: false,
      activitiesFetchNextPage: vi.fn(),
      isFetchingNextActivities: false,
    },
    segments: [{ value: 'all', label: 'All Contacts' }],
    customSegments: [CUSTOM_SEGMENT],
    currentSegment: 'all',
    searchTerm: '',
    urlQueryParams: new URLSearchParams(),
    pagination: null,
    isLoading: false,
    isVoterDataUnavailable: false,
    isCustomSegment: false,
    totalSegmentContacts: 0,
    canUseProFeatures: true,
    isElectedOfficial: false,
    isWinContext: false,
    isWinContextReady: true,
    pageUp: vi.fn(),
    pageDown: vi.fn(),
    goToPage: vi.fn(),
    setPageSize: vi.fn(),
    selectPerson: vi.fn(),
    selectSegment: vi.fn(),
    searchContacts: vi.fn(),
    refreshCustomSegments: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  mockedUseContactsTable.mockReturnValue(ctx)
  return ctx
}

describe('SegmentSection delete affordance', () => {
  beforeEach(() => {
    mockedUseShowContactProModal.mockReturnValue(vi.fn())
    vi.mocked(useSnackbar).mockReturnValue({
      successSnackbar: vi.fn(),
      errorSnackbar: vi.fn(),
      displaySnackbar: vi.fn(),
    })
    api.mock('DELETE /v1/voters/voter-file/filter/:id', {
      status: 200,
      data: {},
    })
  })

  it('deletes a custom list after confirmation and refreshes segments', async () => {
    const ctx = setContext()
    const user = userEvent.setup()

    render(<SegmentSection />)

    await user.click(screen.getByRole('combobox'))
    await user.click(
      await screen.findByTestId(`delete-segment-${CUSTOM_SEGMENT.id}`),
    )

    const confirm = await screen.findByRole('button', {
      name: 'Delete Segment',
    })
    await user.click(confirm)

    await waitFor(() => {
      expect(ctx.refreshCustomSegments).toHaveBeenCalled()
    })
    // Deleting a non-active list must not move the current selection.
    expect(ctx.selectSegment).not.toHaveBeenCalled()
  })

  it('falls back to the default segment when the active list is deleted', async () => {
    const ctx = setContext({ currentSegment: CUSTOM_SEGMENT.id.toString() })
    const user = userEvent.setup()

    render(<SegmentSection />)

    await user.click(screen.getByRole('combobox'))
    await user.click(
      await screen.findByTestId(`delete-segment-${CUSTOM_SEGMENT.id}`),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Delete Segment' }),
    )

    await waitFor(() => {
      expect(ctx.selectSegment).toHaveBeenCalledWith('all')
    })
  })
})
