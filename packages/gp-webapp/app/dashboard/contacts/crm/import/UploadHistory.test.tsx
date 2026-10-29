import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { UploadHistory } from './UploadHistory'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))

const makeUpload = (overrides: Partial<ContactUpload> = {}): ContactUpload => ({
  id: 'upload-1',
  createdAt: '2026-09-14T12:00:00.000Z',
  name: 'Town hall sign-in, Sep 2026',
  fileName: 'townhall-signins.csv',
  uploadedBy: { id: 1, name: 'Sarah Chen' },
  status: 'complete',
  columnMapping: {
    firstName: 'First name',
    lastName: 'Last name',
    email: null,
    cellPhone: null,
    landline: null,
    addressLine: null,
    city: null,
    zip: null,
  },
  rowCount: 86,
  matchedCount: 61,
  newCount: 25,
  needsInputCount: 0,
  skippedCount: 0,
  invalidCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  completedAt: null,
  failureReason: null,
  ...overrides,
})

describe('<UploadHistory>', () => {
  beforeEach(() => {
    vi.mocked(router.push!).mockClear()
  })

  it('lists each upload, newest first, with its file, uploader, date and status', async () => {
    api.mock('GET /v1/contact-uploads', {
      status: 200,
      data: {
        uploads: [
          makeUpload(),
          makeUpload({
            id: 'upload-2',
            createdAt: '2026-10-20T12:00:00.000Z',
            name: 'Newsletter, Oct 2026',
            fileName: 'newsletter-subscribers.csv',
            status: 'needs_input',
            needsInputCount: 20,
          }),
          makeUpload({
            id: 'upload-3',
            createdAt: '2026-08-01T12:00:00.000Z',
            name: 'Ward picnic',
            fileName: 'picnic.csv',
            uploadedBy: null,
            status: 'failed',
          }),
        ],
      },
    })

    render(<UploadHistory />)

    const rows = await screen.findAllByRole('button', { name: /\.csv/ })
    expect(
      rows.map((row) => within(row).getAllByText(/./)[0]?.textContent),
    ).toEqual([
      'Newsletter, Oct 2026',
      'Town hall sign-in, Sep 2026',
      'Ward picnic',
    ])
    expect(
      within(rows[0]!).getByText('newsletter-subscribers.csv, Sarah Chen'),
    ).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Needs input')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Sep 14, 2026')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Complete')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('picnic.csv')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Failed')).toBeInTheDocument()
    // Counts live on an upload's own page, never on the list.
    expect(screen.queryByText('61')).not.toBeInTheDocument()
  })

  it('opens an upload when its row is clicked', async () => {
    api.mock('GET /v1/contact-uploads', {
      status: 200,
      data: { uploads: [makeUpload()] },
    })
    const user = userEvent.setup()

    render(<UploadHistory />)
    await user.click(
      await screen.findByRole('button', { name: /Town hall sign-in/ }),
    )

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/contacts/uploads/upload-1',
    )
  })

  it('says there are no uploads yet and offers to import one', async () => {
    api.mock('GET /v1/contact-uploads', {
      status: 200,
      data: { uploads: [] },
    })

    render(<UploadHistory />)

    expect(await screen.findByText('No uploads yet')).toBeInTheDocument()
    expect(
      screen.getByText('Import a file to add people to your constituents.'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Import contacts' }).length,
    ).toBeGreaterThan(0)
  })

  it('says so when the list cannot load', async () => {
    api.mock('GET /v1/contact-uploads', { status: 500, data: {} })

    render(<UploadHistory />)

    expect(
      await screen.findByText(
        "We couldn't load your uploads. Refresh the page to try again.",
      ),
    ).toBeInTheDocument()
  })

  it('checks again while an upload is processing', async () => {
    api.mockOrdered('GET /v1/contact-uploads', [
      {
        status: 200,
        data: { uploads: [makeUpload({ status: 'processing' })] },
      },
      { status: 200, data: { uploads: [makeUpload({ status: 'complete' })] } },
    ])

    render(<UploadHistory />)

    expect(await screen.findByText('Processing')).toBeInTheDocument()
    expect(
      await screen.findByText('Complete', undefined, { timeout: 6000 }),
    ).toBeInTheDocument()
  })

  it("refreshes the org's people once an upload finishes", async () => {
    const orgKeys = [
      ['contacts', { orgSlug: 'eo-test', page: 1 }],
      ['contacts-stats'],
      ['list-detail', 'eo-test', 'all'],
      ['person', 'eo-test', 'person-1'],
      ['contact-sources', 'eo-test', 'person-1'],
      ['contact-engagement', 'activities', 'eo-test', 'person-1', undefined],
    ]
    const otherOrgPerson = ['person', 'eo-other', 'person-1']
    for (const key of [...orgKeys, otherOrgPerson]) {
      testQueryClient.setQueryData(key, {})
    }
    api.mockOrdered('GET /v1/contact-uploads', [
      {
        status: 200,
        data: { uploads: [makeUpload({ status: 'processing' })] },
      },
      { status: 200, data: { uploads: [makeUpload({ status: 'complete' })] } },
    ])

    render(<UploadHistory />)

    expect(await screen.findByText('Processing')).toBeInTheDocument()
    for (const key of orgKeys) {
      expect(testQueryClient.getQueryState(key)?.isInvalidated).toBe(false)
    }
    await screen.findByText('Complete', undefined, { timeout: 6000 })
    for (const key of orgKeys) {
      expect(testQueryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
    expect(testQueryClient.getQueryState(otherOrgPerson)?.isInvalidated).toBe(
      false,
    )
  })
})
