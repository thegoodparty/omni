import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
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
vi.mock('app/shared/experiments/serveImportContactsFlag', () => ({
  useServeImportContactsFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('../map/ContactListMap', () => ({
  __esModule: true,
  default: () => <div data-testid="contact-map-stub" />,
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

const selectList = vi.fn()

const upload = (overrides: Partial<ContactUpload>): ContactUpload => ({
  id: 'upload-1',
  createdAt: '2026-11-10T12:00:00.000Z',
  name: 'Town hall sign-in',
  fileName: 'town-hall.csv',
  uploadedBy: null,
  status: 'complete',
  columnMapping: {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    cellPhone: null,
    landline: null,
    addressLine: null,
    city: null,
    zip: null,
  },
  rowCount: 148,
  matchedCount: 100,
  newCount: 48,
  needsInputCount: 0,
  skippedCount: 0,
  invalidCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  completedAt: '2026-11-10T12:01:00.000Z',
  failureReason: null,
  failureKind: null,
  progress: null,
  ...overrides,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
  api.reset()
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })
  mockedUseContactsTable.mockReturnValue({
    isElectedOfficial: true,
    isWinContext: false,
    isWinContextReady: true,
    canUseProFeatures: true,
    refreshCustomSegments: vi.fn().mockResolvedValue(undefined),
    selectList,
    customSegments: [],
  } as unknown as ContextValue)
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 148 } })
  api.mock('GET /v1/contacts/precincts', {
    status: 200,
    data: { options: [], truncated: false },
  })
  api.mock('POST /v1/contacts/points', {
    status: 200,
    data: { points: [], truncated: false },
  })
  api.mock('GET /v1/contact-uploads', {
    status: 200,
    data: {
      uploads: [
        upload({}),
        upload({ id: 'upload-2', name: 'Newsletter list' }),
        upload({ id: 'upload-3', name: 'Broken file', status: 'failed' }),
      ],
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CreateListWizard — Imported in', () => {
  it('saves a list of the picked imports and counts the group in List Created', async () => {
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 102, name: 'Town hall sign-in' } }
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      await screen.findByRole('button', { name: 'Town hall sign-in' }),
    )
    expect(
      screen.getByRole('button', { name: 'Newsletter list' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Broken file' })).toBeNull()

    await user.click(
      await screen.findByRole('button', { name: /build your list \(148\)/i }),
    )
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText(/list name/i), 'Town hall sign-in')
    const save = screen.getByRole('button', { name: 'Save list' })
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })
    await user.click(save)

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Town hall sign-in',
      contactUploadIds: ['upload-1'],
    })
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentData.ListCreated,
        {
          source: 'crmWizard',
          branch: 'voterFile',
          listId: 102,
          variableCount: 1,
        },
      ),
    )
  })

  it("shows an edited list's imports picked, an undone one under a fallback label, and saves its removal", async () => {
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 47 } }
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <CreateListWizard
        open
        onOpenChange={vi.fn()}
        editingSegment={{
          id: 47,
          name: 'Town hall sign-in',
          contactUploadIds: ['upload-1', 'upload-gone'],
        }}
      />,
    )

    expect(
      await screen.findByRole('button', { name: 'Town hall sign-in' }),
    ).toHaveAttribute('aria-pressed', 'true')
    const undone = screen.getByRole('button', { name: 'Undone import' })
    expect(undone).toHaveAttribute('aria-pressed', 'true')

    await user.click(undone)
    const save = await screen.findByRole('button', { name: /save changes/i })
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })
    await user.click(save)

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({ contactUploadIds: ['upload-1'] })
  })
})
