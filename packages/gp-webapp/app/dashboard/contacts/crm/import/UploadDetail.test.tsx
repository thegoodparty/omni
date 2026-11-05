import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  ContactUpload,
  ContactUploadRow,
  SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSearchParams } from 'next/navigation'
import { makePerson } from '../shared/test-fixtures'
import { UploadDetail } from './UploadDetail'

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({
    children,
    navHeader,
  }: {
    children: React.ReactNode
    navHeader?: { label: string }
  }) => (
    <div>
      <div data-testid="nav-header">{navHeader?.label}</div>
      {children}
    </div>
  ),
}))
vi.mock('app/dashboard/contacts/crm/person/PersonOverlay', () => ({
  PersonCardSheet: ({
    personId,
    onClose,
    uploadRow,
  }: {
    personId: string | null
    onClose: () => void
    uploadRow?: { onChanged?: () => void }
  }) =>
    personId ? (
      <div data-testid="person-sheet">
        {personId}
        <button onClick={onClose}>Close record</button>
        {/* What ChangeMatchDialog does once a change saves. */}
        <button
          onClick={async () => {
            await testQueryClient.invalidateQueries({
              queryKey: ['contact-uploads'],
            })
            uploadRow?.onChanged?.()
          }}
        >
          Save changed match
        </button>
      </div>
    ) : null,
}))
vi.mock('./ImportContactsWizard', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-wizard" /> : null,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))
vi.mock('app/dashboard/shared/useWinVoterContext', () => ({
  useWinVoterContext: () => ({ isWin: false, isReady: true }),
}))

const PERSON_KEY = ['person', 'eo-test', 'person-1']

const makeUpload = (overrides: Partial<ContactUpload> = {}): ContactUpload => ({
  id: 'upload-1',
  createdAt: '2026-10-20T12:00:00.000Z',
  name: 'Newsletter, Oct 2026',
  fileName: 'newsletter-subscribers.csv',
  uploadedBy: { id: 1, name: 'Sarah Chen' },
  status: 'needs_input',
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
  rowCount: 240,
  matchedCount: 168,
  newCount: 52,
  needsInputCount: 2,
  skippedCount: 0,
  invalidCount: 18,
  updatedCount: 0,
  unchangedCount: 0,
  completedAt: null,
  failureReason: null,
  failureKind: null,
  ...overrides,
})

const makeRow = (
  overrides: Partial<ContactUploadRow> = {},
): ContactUploadRow => ({
  id: 'row-1',
  rowIndex: 1,
  firstName: 'M.',
  lastName: 'Lopez',
  email: 'maria.lopez@example.com',
  cellPhone: null,
  landline: null,
  addressLine: '14 Oak St',
  city: null,
  zip: null,
  outcome: 'needs_input',
  personId: null,
  isNewPerson: false,
  changedFields: [],
  candidates: [],
  suggestedPersonId: null,
  ...overrides,
})

const NEEDS_INPUT_ROWS = [
  makeRow({
    candidates: [
      {
        personId: '0190f4a5-0000-7000-8000-000000000001',
        firstName: 'Maria',
        lastName: 'Lopez',
        addressLine: '14 Oak St',
        city: 'Maplewood',
        zip: '55001',
        age: 54,
      },
    ],
    suggestedPersonId: '0190f4a5-0000-7000-8000-000000000001',
  }),
  makeRow({
    id: 'row-2',
    rowIndex: 2,
    firstName: 'J.',
    lastName: 'Okafor',
    email: null,
    addressLine: null,
    candidates: [
      {
        personId: '0190f4a5-0000-7000-8000-000000000002',
        firstName: 'James',
        lastName: 'Okafor',
        addressLine: '220 Maple Ave',
        city: 'Maplewood',
        zip: '55001',
        age: 61,
      },
      {
        personId: '0190f4a5-0000-7000-8000-000000000003',
        firstName: 'Jane',
        lastName: 'Okafor',
        addressLine: '31 Elm St',
        city: 'Maplewood',
        zip: '55001',
        age: 40,
      },
      {
        personId: '0190f4a5-0000-7000-8000-000000000004',
        firstName: 'Jane',
        lastName: 'Okafor',
        addressLine: '31 Elm St',
        city: 'Maplewood',
        zip: '55001',
        age: 72,
      },
    ],
  }),
]

const mockRows = (processed: ContactUploadRow[] = []) =>
  api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => ({
    status: 200,
    data:
      query.outcome === 'needs_input'
        ? { rows: NEEDS_INPUT_ROWS, nextCursor: null, total: 2 }
        : { rows: processed, nextCursor: null, total: processed.length },
  }))

describe('<UploadDetail>', () => {
  beforeEach(() => {
    vi.mocked(router.push!).mockClear()
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    )
  })

  it('shows what happened to the file', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ updatedCount: 4 }),
    })
    mockRows()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByRole('heading', { name: 'Newsletter, Oct 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'newsletter-subscribers.csv · Imported Oct 20, 2026 by Sarah Chen · 240 people',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Imported')).toBeInTheDocument()
    expect(screen.getByText('220')).toBeInTheDocument()
    expect(
      screen.getByText('Already in your constituent list'),
    ).toBeInTheDocument()
    expect(screen.getByText('168')).toBeInTheDocument()
    expect(screen.getByText('New people')).toBeInTheDocument()
    expect(screen.getByText('52')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Need you to choose who they are/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Need a first and last name/ }),
    ).toHaveTextContent('18')
    expect(screen.queryByText('Skipped by you')).not.toBeInTheDocument()
  })

  it('saves an answer for each row the user picked', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload(),
    })
    mockRows()
    const saved: Array<{ rowId: string; body: SetContactUploadRowMatch }> = []
    api.mock(
      'PUT /v1/contact-uploads/:id/rows/:rowId/match',
      ({ params, body }) => {
        saved.push({ rowId: params.rowId, body })
        return { status: 200, data: makeUpload() }
      },
    )
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByRole('heading', { name: '2 rows need your input' }),
    ).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save my answers' })
    expect(save).toBeDisabled()

    const maria = await screen.findByRole('radiogroup', {
      name: 'M. Lopez, 14 Oak St',
    })
    await user.click(
      within(maria).getByLabelText(
        'Same as Maria Lopez, 14 Oak St, 54 years old',
      ),
    )
    const okafor = screen.getByRole('radiogroup', { name: 'J. Okafor' })
    expect(
      within(okafor).getByLabelText(
        'Same as Jane Okafor, 31 Elm St, 40 years old',
      ),
    ).toBeInTheDocument()
    expect(
      within(okafor).getByLabelText(
        'Same as Jane Okafor, 31 Elm St, 72 years old',
      ),
    ).toBeInTheDocument()
    await user.click(within(okafor).getByLabelText('New person'))

    await user.click(save)

    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved).toEqual([
      {
        rowId: 'row-1',
        body: { personId: '0190f4a5-0000-7000-8000-000000000001' },
      },
      { rowId: 'row-2', body: { newPerson: true } },
    ])
  })

  it('saves someone the user searched for when no offered person is right', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload(),
    })
    mockRows()
    const searches: string[] = []
    api.mock('GET /v1/contacts', ({ query }) => {
      searches.push(query.search ?? '')
      return {
        status: 200,
        data: {
          pagination: {
            totalResults: 1,
            currentPage: 1,
            pageSize: 8,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          people: [
            makePerson({
              id: '0190f4a5-0000-7000-8000-000000000042',
              firstName: 'Jimmy',
              lastName: 'Okafor-Reed',
              age: 63,
              address: {
                ...makePerson().address,
                line1: '220 Maple Ave',
                city: 'Maplewood',
              },
            }),
          ],
        },
      }
    })
    const saved: Array<{ rowId: string; body: SetContactUploadRowMatch }> = []
    api.mock(
      'PUT /v1/contact-uploads/:id/rows/:rowId/match',
      ({ params, body }) => {
        saved.push({ rowId: params.rowId, body })
        return { status: 200, data: makeUpload() }
      },
    )
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    const okafor = await screen.findByRole('radiogroup', { name: 'J. Okafor' })
    await user.click(within(okafor).getByLabelText('Someone else'))
    const save = screen.getByRole('button', { name: 'Save my answers' })
    expect(save).toBeDisabled()

    await user.type(
      screen.getByRole('textbox', { name: 'Search your constituents' }),
      'Okafor',
    )
    await user.click(
      await screen.findByLabelText(
        'Jimmy Okafor-Reed, 220 Maple Ave, 63 years old',
      ),
    )
    expect(searches).toContain('Okafor')
    expect(save).toBeEnabled()

    await user.click(save)

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved).toEqual([
      {
        rowId: 'row-2',
        body: { personId: '0190f4a5-0000-7000-8000-000000000042' },
      },
    ])
  })

  it('accepts every likely match at once', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload(),
    })
    mockRows()
    let accepted = false
    api.mock('POST /v1/contact-uploads/:id/accept-suggested', () => {
      accepted = true
      return {
        status: 200,
        data: { accepted: 1, upload: makeUpload({ needsInputCount: 1 }) },
      }
    })
    const user = userEvent.setup()

    testQueryClient.setQueryData(PERSON_KEY, {})

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    await user.click(
      await screen.findByRole('button', { name: 'Accept all 1 likely match' }),
    )

    await waitFor(() => expect(accepted).toBe(true))
    await waitFor(() =>
      expect(testQueryClient.getQueryState(PERSON_KEY)?.isInvalidated).toBe(
        true,
      ),
    )
  })

  it('leaves the rows waiting when the user decides later', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload(),
    })
    mockRows()
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)
    await user.click(
      await screen.findByRole('button', { name: 'Decide later' }),
    )

    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads')
  })

  it('asks before leaving with answers picked, from Decide later and from Back', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload(),
    })
    mockRows()
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)
    const okafor = await screen.findByRole('radiogroup', { name: 'J. Okafor' })
    await user.click(within(okafor).getByLabelText('New person'))

    await user.click(screen.getByRole('button', { name: 'Decide later' }))
    expect(
      screen.getByRole('alertdialog', { name: 'Discard changes?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(router.push).not.toHaveBeenCalled()
    expect(within(okafor).getByLabelText('New person')).toBeChecked()

    await user.click(
      screen.getByRole('link', { name: 'Back to import history' }),
    )
    expect(router.push).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads')
  })

  it('lists processed rows, and a row opens its person over the page', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    mockRows([
      makeRow({
        id: 'row-3',
        firstName: 'Maria',
        outcome: 'matched',
        personId: 'LALMI123',
        changedFields: ['email', 'landline'],
      }),
      makeRow({
        id: 'row-4',
        firstName: 'Dana',
        lastName: 'Whitfield',
        email: 'dana@example.com',
        outcome: 'new',
        personId: '0190f4a5-0000-7000-8000-000000000009',
        isNewPerson: true,
      }),
    ])

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    const user = userEvent.setup()
    const table = await screen.findByRole('table')
    const rows = within(table)
    await user.click(await rows.findByRole('button', { name: /Maria Lopez/ }))
    expect(screen.getByTestId('person-sheet')).toHaveTextContent('LALMI123')
    expect(router.push).not.toHaveBeenCalled()
    expect(
      rows.getByText(
        'Already in your constituents. Updated email and landline.',
      ),
    ).toBeInTheDocument()
    expect(rows.getByText('New person. Added.')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /need your input/ }),
    ).not.toBeInTheDocument()
    // Change match lives in the person's record, not in the table.
    expect(
      screen.queryByRole('button', { name: 'Change match' }),
    ).not.toBeInTheDocument()
  })

  it('opens the row a Came from link names, and closing it drops the row from the URL', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    const linked = makeRow({
      id: '0190f4a5-0000-7000-8000-0000000000aa',
      rowIndex: 180,
      firstName: 'Maria',
      outcome: 'matched',
      personId: 'LALMI123',
    })
    const queries: Array<Record<string, unknown>> = []
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => {
      queries.push(query)
      return {
        status: 200,
        data: query.rowId
          ? { rows: [linked], nextCursor: null, total: 1 }
          : { rows: [], nextCursor: null, total: 0 },
      }
    })
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`row=${linked.id}`) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    window.history.replaceState(
      null,
      '',
      `/dashboard/contacts/uploads/upload-1?row=${linked.id}`,
    )
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(await screen.findByTestId('person-sheet')).toHaveTextContent(
      'LALMI123',
    )
    expect(queries).toContainEqual(
      expect.objectContaining({ outcome: 'processed', rowId: linked.id }),
    )
    await user.click(screen.getByRole('button', { name: 'Close record' }))
    expect(screen.queryByTestId('person-sheet')).not.toBeInTheDocument()
    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/contacts/uploads/upload-1',
    )
  })

  it('does not reopen a linked row on the person Change match pointed it at', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    const rowId = '0190f4a5-0000-7000-8000-0000000000cc'
    let personId = 'LALMI123'
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => ({
      status: 200,
      data: query.rowId
        ? {
            rows: [
              makeRow({
                id: rowId,
                firstName: 'Maria',
                outcome: personId === 'LALMI123' ? 'matched' : 'resolved',
                personId,
              }),
            ],
            nextCursor: null,
            total: 1,
          }
        : { rows: [], nextCursor: null, total: 0 },
    }))
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`row=${rowId}`) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(await screen.findByTestId('person-sheet')).toHaveTextContent(
      'LALMI123',
    )
    personId = 'LALOT456'
    await user.click(screen.getByRole('button', { name: 'Save changed match' }))

    await waitFor(() =>
      expect(screen.queryByTestId('person-sheet')).not.toBeInTheDocument(),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('person-sheet')).not.toBeInTheDocument()
  })

  it('opens the page as usual when the linked row is no longer processed', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    const queries: Array<Record<string, unknown>> = []
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => {
      queries.push(query)
      return {
        status: 200,
        data: query.rowId
          ? { rows: [], nextCursor: null, total: 0 }
          : {
              rows: [
                makeRow({
                  id: 'row-3',
                  firstName: 'Dana',
                  outcome: 'new',
                  personId: '0190f4a5-0000-7000-8000-000000000009',
                  isNewPerson: true,
                }),
              ],
              nextCursor: null,
              total: 1,
            },
      }
    })
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(
        'row=0190f4a5-0000-7000-8000-0000000000bb',
      ) as unknown as ReturnType<typeof useSearchParams>,
    )

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await within(await screen.findByRole('table')).findByRole('button', {
        name: /Dana Lopez/,
      }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(queries).toContainEqual(
        expect.objectContaining({
          rowId: '0190f4a5-0000-7000-8000-0000000000bb',
        }),
      ),
    )
    expect(screen.queryByTestId('person-sheet')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('filters processed rows to people in or not in the constituent file', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    const maria = makeRow({
      id: 'row-3',
      firstName: 'Maria',
      outcome: 'matched',
      personId: 'LALMI123',
    })
    const dana = makeRow({
      id: 'row-4',
      firstName: 'Dana',
      lastName: 'Whitfield',
      outcome: 'new',
      personId: '0190f4a5-0000-7000-8000-000000000009',
      isNewPerson: true,
    })
    const queries: Array<string | undefined> = []
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => {
      queries.push(query.inVoterFile)
      const rows =
        query.inVoterFile === 'true'
          ? [maria]
          : query.inVoterFile === 'false'
            ? query.search
              ? []
              : [dana]
            : [maria, dana]
      return {
        status: 200,
        data: { rows, nextCursor: null, total: rows.length },
      }
    })

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    const user = userEvent.setup()
    const table = within(await screen.findByRole('table'))
    expect(await table.findByText('Maria Lopez')).toBeInTheDocument()
    expect(table.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(queries).toEqual([undefined])

    await user.click(
      screen.getByRole('radio', { name: 'Not in your constituent file' }),
    )
    await waitFor(() =>
      expect(table.queryByText('Maria Lopez')).not.toBeInTheDocument(),
    )
    expect(table.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(queries).toContain('false')

    await user.click(
      screen.getByRole('radio', { name: 'In your constituent file' }),
    )
    expect(await table.findByText('Maria Lopez')).toBeInTheDocument()
    expect(table.queryByText('Dana Whitfield')).not.toBeInTheDocument()
    expect(queries).toContain('true')

    await user.click(
      screen.getByRole('radio', { name: 'Not in your constituent file' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Search processed rows' }),
      'zed',
    )
    expect(
      await table.findByText(
        'No rows match your search. Try another name or email.',
      ),
    ).toBeInTheDocument()
    await user.clear(
      screen.getByRole('textbox', { name: 'Search processed rows' }),
    )
    expect(await table.findByText('Dana Whitfield')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All' }))
    expect(await table.findByText('Maria Lopez')).toBeInTheDocument()
    expect(table.getByText('Dana Whitfield')).toBeInTheDocument()
  })

  it('says when no processed row matches the filter', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    mockRows([])

    render(<UploadDetail uploadId="upload-1" isWin />)

    const user = userEvent.setup()
    const table = within(await screen.findByRole('table'))
    expect(
      await table.findByText('No rows were added from this file yet.'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('radio', { name: 'Not in your voter file' }),
    )
    expect(
      await table.findByText(
        'No rows match this filter. Pick All to see every row.',
      ),
    ).toBeInTheDocument()
  })

  it('reads Win nouns for a campaign: the voter file, not constituents', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'complete', needsInputCount: 0 }),
    })
    mockRows([
      makeRow({
        id: 'row-3',
        firstName: 'Maria',
        outcome: 'matched',
        personId: 'LALMI123',
        changedFields: ['email'],
      }),
      makeRow({
        id: 'row-4',
        firstName: 'Avery',
        lastName: 'Testwell',
        outcome: 'matched',
        personId: '0190f4a5-0000-7000-8000-000000000011',
        isNewPerson: true,
      }),
    ])

    render(<UploadDetail uploadId="upload-1" isWin />)

    expect(
      (
        await screen.findAllByText('Already in your voter file. Updated email.')
      )[0],
    ).toBeInTheDocument()
    expect(
      screen.getAllByText('Already added from an earlier import.')[0],
    ).toBeInTheDocument()
    expect(screen.getByText('Already in your contacts')).toBeInTheDocument()
    expect(screen.getByText('New people')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to import history' }),
    ).toHaveAttribute('href', '/dashboard/contacts/uploads')
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('opens the rows missing a name with their row in the file, and downloads every one', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({
        status: 'complete',
        needsInputCount: 0,
        skippedCount: 0,
        invalidCount: 3,
        columnMapping: {
          ...makeUpload().columnMapping,
          cellPhone: 'Phone',
          addressLine: 'Street',
        },
      }),
    })
    const requestedCursors: unknown[] = []
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => {
      if (query.outcome !== 'invalid') {
        return { status: 200, data: { rows: [], nextCursor: null, total: 0 } }
      }
      const cursor = query.cursor
      requestedCursors.push(cursor)
      return {
        status: 200,
        data:
          cursor === undefined
            ? {
                rows: [
                  makeRow({
                    id: 'row-5',
                    rowIndex: 3,
                    firstName: 'Maria',
                    lastName: null,
                    email: 'maria@example.com',
                    cellPhone: '(555) 010-0001',
                    addressLine: '14 Oak St, Apt 2',
                    outcome: 'invalid',
                  }),
                  makeRow({
                    id: 'row-6',
                    rowIndex: 7,
                    firstName: null,
                    lastName: null,
                    email: null,
                    addressLine: null,
                    outcome: 'invalid',
                  }),
                ],
                nextCursor: 7,
                total: 3,
              }
            : {
                rows: [
                  makeRow({
                    id: 'row-7',
                    rowIndex: 9,
                    firstName: null,
                    lastName: 'Okafor',
                    email: '=HYPERLINK("http://x.test")',
                    addressLine: null,
                    outcome: 'invalid',
                  }),
                ],
                nextCursor: null,
                total: 3,
              },
      }
    })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:skipped-rows')
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByRole('button', {
        name: /Need a first and last name/,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Skipped by you')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Need a first and last name/ }),
    )

    const sheet = within(
      await screen.findByRole('dialog', {
        name: 'Rows missing a first or last name',
      }),
    )
    expect(
      sheet.getByText(
        'Add a first and last name to each row, then import them again.',
      ),
    ).toBeInTheDocument()
    const maria = (await sheet.findByText('Maria')).closest('li')!
    expect(within(maria).getByText('Row 5')).toBeInTheDocument()
    expect(
      within(maria).getByText(
        'maria@example.com · (555) 010-0001 · 14 Oak St, Apt 2',
        { exact: false },
      ),
    ).toBeInTheDocument()
    expect(
      within(sheet.getByText('No name').closest('li')!).getByText('Row 9'),
    ).toBeInTheDocument()
    expect(
      sheet.getByRole('button', { name: 'Show more rows' }),
    ).toBeInTheDocument()

    await user.click(sheet.getByRole('button', { name: 'Download these rows' }))

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    const blob = createObjectURL.mock.calls[0]![0] as Blob
    // jsdom's Blob has no text().
    const csv = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(blob)
    })
    expect(csv).toBe(
      [
        'Row,First name,Last name,Email,Phone,Street',
        '5,Maria,,maria@example.com,(555) 010-0001,"14 Oak St, Apt 2"',
        '9,,,,,',
        '11,,Okafor,"\'=HYPERLINK(""http://x.test"")",,',
        '',
      ].join('\r\n'),
    )
    expect(requestedCursors).toEqual([undefined, undefined, '7'])
  })

  it('opens the rows a campaign skipped in Win nouns', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({
        status: 'complete',
        needsInputCount: 0,
        skippedCount: 1,
        invalidCount: 0,
      }),
    })
    api.mock('GET /v1/contact-uploads/:id/rows', ({ query }) => ({
      status: 200,
      data:
        query.outcome === 'skipped'
          ? {
              rows: [
                makeRow({
                  id: 'row-8',
                  rowIndex: 0,
                  firstName: 'Dana',
                  lastName: 'Whitfield',
                  outcome: 'skipped',
                }),
              ],
              nextCursor: null,
              total: 1,
            }
          : { rows: [], nextCursor: null, total: 0 },
    }))
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin />)

    await screen.findByText('Imported')
    expect(
      screen.queryByText('Need a first and last name'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Skipped by you/ }))

    const sheet = within(
      await screen.findByRole('dialog', { name: 'Rows you skipped' }),
    )
    const dana = (await sheet.findByText('Dana Whitfield')).closest('li')!
    expect(within(dana).getByText('Row 2')).toBeInTheDocument()
    expect(
      sheet.queryByRole('button', { name: 'Show more rows' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('tries a failed upload again', async () => {
    let status: ContactUpload['status'] = 'failed'
    api.mock('GET /v1/contact-uploads/:id', () => ({
      status: 200,
      data: makeUpload({
        status,
        failureKind: status === 'failed' ? 'transient' : null,
      }),
    }))
    mockRows()
    let retried = false
    api.mock('POST /v1/contact-uploads/:id/retry', () => {
      retried = true
      status = 'processing'
      return { status: 200, data: makeUpload({ status }) }
    })
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByText("This import didn't finish. Try again."),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(retried).toBe(true))
    expect(
      await screen.findByText(
        "We're matching your people. This page updates when it's done.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()
  })

  it('says it is still matching, without counts, before the file is read', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'processing', rowCount: null }),
    })

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByText(
        "We're matching your people. This page updates when it's done.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(
      screen.getByText(
        'newsletter-subscribers.csv · Imported Oct 20, 2026 by Sarah Chen',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Processed rows')).not.toBeInTheDocument()
  })

  it('says why a file could not be imported, and offers a new file instead of Try again', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({
        status: 'failed',
        rowCount: null,
        failureReason:
          'This file has no column named "Email". Import it again and pick columns it has.',
        failureKind: 'file',
      }),
    })

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    expect(
      await screen.findByText(
        'This file has no column named "Email". Import it again and pick columns it has.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Already in your constituent list'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Processed rows')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()

    expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Import a new file' }))
    expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
  })

  it("refreshes the org's people once the upload finishes", async () => {
    testQueryClient.setQueryData(PERSON_KEY, {})
    api.mockOrdered('GET /v1/contact-uploads/:id', [
      { status: 200, data: makeUpload({ status: 'processing' }) },
      { status: 200, data: makeUpload({ status: 'complete' }) },
    ])
    mockRows()

    render(<UploadDetail uploadId="upload-1" isWin={false} />)

    await screen.findByText(
      "We're matching your people. This page updates when it's done.",
    )
    expect(testQueryClient.getQueryState(PERSON_KEY)?.isInvalidated).toBe(false)
    await screen.findByText('Complete', undefined, { timeout: 6000 })
    expect(testQueryClient.getQueryState(PERSON_KEY)?.isInvalidated).toBe(true)
  })
})
