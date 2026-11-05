import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { NeedsInputAlert } from './NeedsInputAlert'

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
  ...overrides,
})

describe('<NeedsInputAlert>', () => {
  it('shows nothing when no import needs input', () => {
    const { container } = render(
      <NeedsInputAlert
        uploads={[
          makeUpload(),
          makeUpload({ id: 'upload-2', status: 'processing' }),
        ]}
        isWin={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('sends one waiting import to its own page', () => {
    render(
      <NeedsInputAlert
        uploads={[
          makeUpload(),
          makeUpload({
            id: 'upload-2',
            name: 'Volunteer contacts',
            status: 'needs_input',
            needsInputCount: 12,
          }),
        ]}
        isWin
      />,
    )

    expect(
      screen.getByText('12 people from “Volunteer contacts” need your input'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/dashboard/contacts/uploads/upload-2',
    )
  })

  it('reads one person in the singular', () => {
    render(
      <NeedsInputAlert
        uploads={[makeUpload({ status: 'needs_input', needsInputCount: 1 })]}
        isWin={false}
      />,
    )

    expect(
      screen.getByText('1 person from “Newsletter, Oct 2026” needs your input'),
    ).toBeInTheDocument()
  })

  it('sends several waiting imports to Imports', () => {
    render(
      <NeedsInputAlert
        uploads={[
          makeUpload({ status: 'needs_input', needsInputCount: 3 }),
          makeUpload({
            id: 'upload-2',
            status: 'needs_input',
            needsInputCount: 5,
          }),
        ]}
        isWin={false}
      />,
    )

    expect(screen.getByText('2 imports need your input')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See imports' })).toHaveAttribute(
      'href',
      '/dashboard/contacts/uploads',
    )
  })
})
