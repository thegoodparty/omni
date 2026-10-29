import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ContactUpload } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ImportContactsWizard from './ImportContactsWizard'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const makeUpload = (overrides: Partial<ContactUpload> = {}): ContactUpload => ({
  id: 'upload-1',
  createdAt: '2026-10-01T12:00:00.000Z',
  name: 'Town hall sign-in',
  fileName: 'townhall.csv',
  uploadedBy: { id: 1, name: 'Sarah Chen' },
  status: 'complete',
  columnMapping: {
    firstName: 'Given',
    lastName: 'Family',
    email: null,
    cellPhone: 'Phone',
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
  completedAt: '2026-10-01T12:01:00.000Z',
  failureReason: null,
  ...overrides,
})

const csv = (text: string, name = 'newsletter.csv') =>
  new File([text], name, { type: 'text/csv' })

const NEWSLETTER = csv(
  'First name,Last name,Email,Mobile,Heard about me\nMaria,Lopez,maria@example.com,(616) 555-0142,Flyer\nDana,Whitfield,dana@example.com,,Friend\n',
)

const renderWizard = (onOpenChange = vi.fn()) => {
  render(<ImportContactsWizard open onOpenChange={onOpenChange} />)
  return onOpenChange
}

const chooseFile = async (
  user: ReturnType<typeof userEvent.setup>,
  file: File,
) => {
  await user.upload(screen.getByLabelText('Choose a file'), file)
}

describe('<ImportContactsWizard>', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
    vi.mocked(router.push!).mockClear()
    api.mock('GET /v1/contact-uploads', {
      status: 200,
      data: { uploads: [] },
    })
  })

  it('reads the file, then matches columns by their names', async () => {
    const user = userEvent.setup()
    renderWizard()

    await chooseFile(user, NEWSLETTER)

    expect(
      await screen.findByText(
        '2 people found. Columns in your file: First name, Last name, Email, Mobile, Heard about me.',
      ),
    ).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.ImportStarted, {
      sourceType: 'csv',
      rowCount: 2,
    })

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('heading', { name: 'Which column has each detail?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'First name' }),
    ).toHaveTextContent('First name')
    expect(
      screen.getByRole('combobox', { name: 'Cell phone' }),
    ).toHaveTextContent('Mobile')
    expect(
      screen.getByRole('combobox', { name: 'Landline' }),
    ).toHaveTextContent('Do not import')
    expect(screen.getByText('(616) 555-0142')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('holds the columns step until a first and last name column is picked', async () => {
    const user = userEvent.setup()
    renderWizard()

    await chooseFile(user, csv('Name,Email\nMaria Lopez,maria@example.com\n'))
    await screen.findByText(/1 person found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('combobox', { name: 'First name' }),
    ).toHaveTextContent('Do not import')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it("reuses the latest upload's columns when the file has them", async () => {
    api.mock('GET /v1/contact-uploads', {
      status: 200,
      data: { uploads: [makeUpload()] },
    })
    const user = userEvent.setup()
    renderWizard()
    await waitFor(() =>
      expect(screen.getByLabelText('Choose a file')).toBeInTheDocument(),
    )

    await chooseFile(
      user,
      csv(
        'Given,Family,Phone,Mobile\nMaria,Lopez,(616) 555-0100,(616) 555-0142\n',
      ),
    )
    await screen.findByText(/1 person found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('combobox', { name: 'Cell phone' }),
    ).toHaveTextContent('Phone')
  })

  it('turns away a file that is not a CSV or is over 25 MB', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderWizard()

    await chooseFile(user, new File(['x'], 'people.xlsx'))
    expect(
      await screen.findByText(
        'This file is not a CSV. Save it as a CSV and try again.',
      ),
    ).toBeInTheDocument()

    const big = csv('First name,Last name\nMaria,Lopez\n')
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    await chooseFile(user, big)
    expect(
      await screen.findByText(
        'This file is over 25 MB. Split it into smaller files and try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('imports only with a name and the consent box, then goes to Upload history', async () => {
    let sent: FormData | null = null
    mswServer.use(
      http.post('/api/v1/contact-uploads', async ({ request }) => {
        sent = await request.formData()
        return HttpResponse.json(makeUpload({ status: 'processing' }))
      }),
    )
    const user = userEvent.setup()
    const onOpenChange = renderWizard()

    await chooseFile(user, NEWSLETTER)
    await screen.findByText(/2 people found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const importButton = screen.getByRole('button', {
      name: 'Import 2 people',
    })
    expect(importButton).toBeDisabled()

    await user.type(
      screen.getByLabelText('Upload name'),
      'Newsletter, Oct 2026',
    )
    expect(importButton).toBeDisabled()

    await user.click(
      screen.getByLabelText(
        'These people agreed to hear from me. I am responsible for that.',
      ),
    )
    expect(importButton).toBeEnabled()

    await user.click(importButton)

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads'),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(sent).not.toBeNull()
    const form = sent as unknown as FormData
    expect(form.get('name')).toBe('Newsletter, Oct 2026')
    expect(form.get('consentAffirmed')).toBe('true')
    expect(JSON.parse(String(form.get('columnMapping')))).toEqual({
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      cellPhone: 'Mobile',
      landline: null,
      addressLine: null,
      city: null,
      zip: null,
    })
    expect(await (form.get('file') as Blob).text()).toMatch(
      /^First name,Last name,Email/,
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ImportConsentAffirmed,
      { rowCount: 2 },
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.ImportAbandoned,
      expect.anything(),
    )
  })

  it('records where the user left off when the wizard closes early', async () => {
    const user = userEvent.setup()
    const onOpenChange = renderWizard()

    await chooseFile(user, NEWSLETTER)
    await screen.findByText(/2 people found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.ImportAbandoned, {
      lastStep: 'columns',
      rowCount: 2,
    })
  })
})
