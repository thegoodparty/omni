import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContactSourcesResponse } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { makePerson } from '../shared/test-fixtures'
import { ImportedContactInformation } from './ImportedContactInformation'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))

vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: () => ({ isWin: false, isReady: true }),
}))

vi.mock('@shared/utils/Map', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-map" />,
}))

const UPLOAD = {
  kind: 'upload' as const,
  uploadId: 'upload-1',
  uploadName: 'Newsletter, Oct 2026',
  uploadedAt: '2026-10-20T12:00:00.000Z',
}

const sources = (
  overrides: Partial<ContactSourcesResponse> = {},
): ContactSourcesResponse => ({
  fields: {
    address: { kind: 'constituent_file' },
    email: UPLOAD,
    cellPhone: { kind: 'constituent_file' },
    landline: UPLOAD,
  },
  uploadRows: [],
  hasActivity: false,
  ...overrides,
})

const person = makePerson({ firstName: 'Maria', lastName: 'Lopez' })

const fieldBlock = (label: string) => {
  const block = screen.getByText(label).parentElement
  if (!block) throw new Error(`${label} not rendered`)
  return block
}

describe('<ImportedContactInformation>', () => {
  it('says where each contact detail came from', async () => {
    api.mock('GET /v1/contacts/:personId/sources', {
      status: 200,
      data: sources(),
    })

    render(
      <ImportedContactInformation
        person={{ ...person, email: 'maria.lopez@example.com' }}
        showMap={false}
      />,
    )

    await screen.findAllByRole('link', {
      name: 'Came from upload Newsletter, Oct 2026',
    })
    expect(
      within(fieldBlock('Email')).getByText('maria.lopez@example.com'),
    ).toBeInTheDocument()
    expect(
      within(fieldBlock('Email')).getByRole('link', {
        name: 'Came from upload Newsletter, Oct 2026',
      }),
    ).toHaveAttribute('href', '/dashboard/contacts/uploads/upload-1')
    expect(
      within(fieldBlock('Landline')).getByRole('link', {
        name: 'Came from upload Newsletter, Oct 2026',
      }),
    ).toBeInTheDocument()
    expect(
      within(fieldBlock('Address')).getByText('Came from the constituent file'),
    ).toBeInTheDocument()
    expect(
      within(fieldBlock('Cell Phone Number')).getByText(
        'Came from the constituent file',
      ),
    ).toBeInTheDocument()
  })

  it('shows Unknown, and no source, for a detail nobody supplied', async () => {
    api.mock('GET /v1/contacts/:personId/sources', {
      status: 200,
      data: sources({
        fields: {
          address: { kind: 'constituent_file' },
          email: null,
          cellPhone: { kind: 'constituent_file' },
          landline: null,
        },
      }),
    })

    render(
      <ImportedContactInformation
        person={{ ...person, email: null, landline: null }}
        showMap={false}
      />,
    )

    await screen.findAllByText('Came from the constituent file')
    expect(within(fieldBlock('Email')).getByText('Unknown')).toBeInTheDocument()
    expect(
      within(fieldBlock('Email')).queryByText(/Came from/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change match' }),
    ).not.toBeInTheDocument()
  })

  it('shows Unknown, not a lone state, for a person with no address', async () => {
    api.mock('GET /v1/contacts/:personId/sources', {
      status: 200,
      data: sources({
        fields: {
          address: null,
          email: UPLOAD,
          cellPhone: null,
          landline: null,
        },
      }),
    })

    render(
      <ImportedContactInformation
        person={{
          ...person,
          email: 'maria.lopez@example.com',
          address: {
            ...person.address,
            line1: null,
            city: null,
            state: 'WY',
            zip: null,
          },
        }}
        showMap={false}
      />,
    )

    await screen.findByRole('link', {
      name: 'Came from upload Newsletter, Oct 2026',
    })
    expect(
      within(fieldBlock('Address')).getByText('Unknown'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/, WY/)).not.toBeInTheDocument()
  })

  it('warns that notes and activity stay behind before changing a match', async () => {
    api.mock('GET /v1/contacts/:personId/sources', {
      status: 200,
      data: sources({
        uploadRows: [
          {
            rowId: 'row-1',
            uploadId: 'upload-1',
            uploadName: 'Newsletter, Oct 2026',
            uploadedAt: '2026-10-20T12:00:00.000Z',
          },
        ],
        hasActivity: true,
      }),
    })
    let sent: unknown = null
    api.mock('PUT /v1/contact-uploads/:id/rows/:rowId/match', ({ body }) => {
      sent = body
      return {
        status: 200,
        data: {
          id: 'upload-1',
          createdAt: '2026-10-20T12:00:00.000Z',
          name: 'Newsletter, Oct 2026',
          fileName: 'newsletter-subscribers.csv',
          uploadedBy: null,
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
          rowCount: 1,
          matchedCount: 0,
          newCount: 0,
          needsInputCount: 0,
          skippedCount: 1,
          invalidCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          completedAt: null,
          failureReason: null,
        },
      }
    })
    const user = userEvent.setup()

    render(<ImportedContactInformation person={person} showMap={false} />)

    await user.click(
      await screen.findByRole('button', { name: 'Change match' }),
    )

    expect(
      await screen.findByText(
        "Notes and activity stay with Maria Lopez. They don't move to the new match.",
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('heading', { name: 'Who is this person?' }),
    ).toBeInTheDocument()
    expect(screen.getByText('From Newsletter, Oct 2026.')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Skip this row'))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Change match',
      }),
    )

    await waitFor(() => expect(sent).toEqual({ skip: true }))
  })
})
