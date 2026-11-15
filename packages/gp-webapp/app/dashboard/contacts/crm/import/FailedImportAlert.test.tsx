import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { FailedImportAlert } from './FailedImportAlert'

const makeUpload = (overrides: Partial<ContactUpload> = {}): ContactUpload => ({
  id: 'upload-1',
  createdAt: '2026-10-20T12:00:00.000Z',
  name: 'Newsletter, Oct 2026',
  fileName: 'newsletter-subscribers.csv',
  uploadedBy: { id: 1, name: 'Sarah Chen' },
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
  rowCount: 240,
  matchedCount: 168,
  newCount: 52,
  needsInputCount: 0,
  skippedCount: 0,
  invalidCount: 20,
  updatedCount: 0,
  unchangedCount: 0,
  completedAt: '2026-10-20T12:05:00.000Z',
  failureReason: null,
  failureKind: null,
  progress: null,
  ...overrides,
})

describe('<FailedImportAlert>', () => {
  it('shows nothing when no import failed', () => {
    const { container } = render(
      <FailedImportAlert
        uploads={[
          makeUpload(),
          makeUpload({ id: 'upload-2', status: 'needs_input' }),
        ]}
        isWin={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('sends one failed import to its own page', () => {
    render(
      <FailedImportAlert
        uploads={[
          makeUpload(),
          makeUpload({
            id: 'upload-2',
            createdAt: '2026-10-21T12:00:00.000Z',
            name: 'Volunteer contacts',
            status: 'failed',
            failureKind: 'file',
          }),
        ]}
        isWin
      />,
    )

    expect(
      screen.getByText("“Volunteer contacts” didn't finish importing"),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open import' })).toHaveAttribute(
      'href',
      '/dashboard/contacts/uploads/upload-2',
    )
  })

  it('sends several failed imports to Import history', () => {
    render(
      <FailedImportAlert
        uploads={[
          makeUpload({ status: 'failed' }),
          makeUpload({ id: 'upload-2', status: 'failed' }),
        ]}
        isWin={false}
      />,
    )

    expect(screen.getByText("2 imports didn't finish")).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'See import history' }),
    ).toHaveAttribute('href', '/dashboard/contacts/uploads')
  })

  it('drops a failure once a later import was started', () => {
    const { container } = render(
      <FailedImportAlert
        uploads={[
          makeUpload({ status: 'failed' }),
          makeUpload({
            id: 'upload-2',
            createdAt: '2026-10-21T12:00:00.000Z',
            status: 'processing',
          }),
        ]}
        isWin={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
