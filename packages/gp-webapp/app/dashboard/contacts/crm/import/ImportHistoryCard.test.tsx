import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ImportHistoryCard } from './ImportHistoryCard'

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
    email: null,
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
  ...overrides,
})

describe('<ImportHistoryCard>', () => {
  it('shows nothing before the first import', () => {
    const { container } = render(
      <ImportHistoryCard uploads={[]} isWin={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('counts every import and opens Import history', () => {
    render(
      <ImportHistoryCard
        uploads={[makeUpload(), makeUpload({ id: 'upload-2' })]}
        isWin
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Your imports' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('People you added from your own files.'),
    ).toBeInTheDocument()
    const row = screen.getByRole('link', { name: /Import history/ })
    expect(row).toHaveTextContent('Import history2')
    expect(row).toHaveAttribute('href', '/dashboard/contacts/uploads')
  })
})
