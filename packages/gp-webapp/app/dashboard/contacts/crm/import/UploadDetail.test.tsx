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
import { UploadDetail } from './UploadDetail'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
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
  })

  it('shows what happened to the file', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ updatedCount: 4 }),
    })
    mockRows()

    render(<UploadDetail uploadId="upload-1" />)

    expect(
      await screen.findByRole('heading', { name: 'Newsletter, Oct 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'newsletter-subscribers.csv · Uploaded Oct 20, 2026 by Sarah Chen · 240 rows',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('168')).toBeInTheDocument()
    expect(screen.getByText('already in your constituents')).toBeInTheDocument()
    expect(screen.getByText('52')).toBeInTheDocument()
    expect(screen.getByText('new people added')).toBeInTheDocument()
    expect(screen.getByText('missing a first or last name')).toBeInTheDocument()
    expect(
      screen.getByText('updated people you imported before'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('unchanged from your last upload'),
    ).not.toBeInTheDocument()
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

    render(<UploadDetail uploadId="upload-1" />)

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

    render(<UploadDetail uploadId="upload-1" />)

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

    render(<UploadDetail uploadId="upload-1" />)
    await user.click(
      await screen.findByRole('button', { name: 'Decide later' }),
    )

    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads')
  })

  it('lists processed rows with what happened and a link to each person', async () => {
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

    render(<UploadDetail uploadId="upload-1" />)

    expect(
      await screen.findByRole('link', { name: 'Maria Lopez' }),
    ).toHaveAttribute('href', '/dashboard/contacts/LALMI123')
    expect(
      screen.getByText(
        'Already in your constituents. Updated email and landline.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('New person. Added.')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /need your input/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Change match' }),
    ).toHaveLength(2)
  })

  it('tries a failed upload again', async () => {
    let status: ContactUpload['status'] = 'failed'
    api.mock('GET /v1/contact-uploads/:id', () => ({
      status: 200,
      data: makeUpload({ status }),
    }))
    mockRows()
    let retried = false
    api.mock('POST /v1/contact-uploads/:id/retry', () => {
      retried = true
      status = 'processing'
      return { status: 200, data: makeUpload({ status }) }
    })
    const user = userEvent.setup()

    render(<UploadDetail uploadId="upload-1" />)

    expect(
      await screen.findByText("This upload didn't finish. Try again."),
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

  it('says it is still matching while the upload processes', async () => {
    api.mock('GET /v1/contact-uploads/:id', {
      status: 200,
      data: makeUpload({ status: 'processing' }),
    })

    render(<UploadDetail uploadId="upload-1" />)

    expect(
      await screen.findByText(
        "We're matching your people. This page updates when it's done.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Processed rows')).not.toBeInTheDocument()
  })

  it("refreshes the org's people once the upload finishes", async () => {
    testQueryClient.setQueryData(PERSON_KEY, {})
    api.mockOrdered('GET /v1/contact-uploads/:id', [
      { status: 200, data: makeUpload({ status: 'processing' }) },
      { status: 200, data: makeUpload({ status: 'complete' }) },
    ])
    mockRows()

    render(<UploadDetail uploadId="upload-1" />)

    await screen.findByText(
      "We're matching your people. This page updates when it's done.",
    )
    expect(testQueryClient.getQueryState(PERSON_KEY)?.isInvalidated).toBe(false)
    await screen.findByText('Complete', undefined, { timeout: 6000 })
    expect(testQueryClient.getQueryState(PERSON_KEY)?.isInvalidated).toBe(true)
  })
})
