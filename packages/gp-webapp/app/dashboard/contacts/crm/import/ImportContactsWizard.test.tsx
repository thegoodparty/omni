import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'
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
  failureKind: null,
  ...overrides,
})

const csv = (text: string, name = 'newsletter.csv') =>
  new File([text], name, { type: 'text/csv' })

const NEWSLETTER = csv(
  'First name,Last name,Email,Mobile,Heard about me\nMaria,Lopez,maria@example.com,(616) 555-0142,Flyer\nDana,Whitfield,dana@example.com,,Friend\n',
)

const renderWizard = (onOpenChange = vi.fn(), isWin = false) => {
  render(
    <ImportContactsWizard open onOpenChange={onOpenChange} isWin={isWin} />,
  )
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
    vi.mocked(usePathname).mockReturnValue('/dashboard/contacts')
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
      product: 'serve',
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

  it('creates the upload, sends the file straight to S3, then confirms it', async () => {
    const S3_PUT_URL = 'https://s3.example/put?sig=abc'
    let presignBody: unknown
    api.mock('POST /v1/contact-uploads/presign', ({ body }) => {
      calls.push('presign')
      presignBody = body
      return {
        status: 200,
        data: {
          uploadId: 'upload-1',
          uploadUrl: S3_PUT_URL,
          expiresAt: '2026-10-01T12:15:00.000Z',
        },
      }
    })
    let put: { contentType: string | null; text: string } | null = null
    mswServer.use(
      http.put(S3_PUT_URL, async ({ request }) => {
        calls.push('put')
        put = {
          contentType: request.headers.get('content-type'),
          text: await request.text(),
        }
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const calls: string[] = []
    let confirmed: unknown
    api.mock('POST /v1/contact-uploads/:id/uploaded', ({ params }) => {
      calls.push('confirm')
      confirmed = params
      return {
        status: 200,
        data: makeUpload({ status: 'processing', rowCount: null }),
      }
    })
    const user = userEvent.setup()
    renderWizard()

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
    expect(calls).toEqual(['presign', 'put', 'confirm'])
    expect(put).toEqual({
      contentType: 'text/csv',
      text: expect.stringMatching(/^First name,Last name,Email/),
    })
    expect(confirmed).toMatchObject({ id: 'upload-1' })
    expect(presignBody).toEqual({
      byteSize: NEWSLETTER.size,
      fileName: 'newsletter.csv',
      name: 'Newsletter, Oct 2026',
      consentAffirmed: true,
      columnMapping: {
        firstName: 'First name',
        lastName: 'Last name',
        email: 'Email',
        cellPhone: 'Mobile',
        landline: null,
        addressLine: null,
        city: null,
        zip: null,
      },
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ImportConsentAffirmed,
      { rowCount: 2, product: 'serve' },
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.ImportAbandoned,
      expect.anything(),
    )
  })

  const importNewsletter = async (user: ReturnType<typeof userEvent.setup>) => {
    await chooseFile(user, NEWSLETTER)
    await screen.findByText(/2 people found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Upload name'), 'Newsletter')
    await user.click(
      screen.getByLabelText(
        'These people agreed to hear from me. I am responsible for that.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Import 2 people' }))
  }

  const mockSuccessfulUpload = (putDone?: Promise<void>) => {
    const S3_PUT_URL = 'https://s3.example/put?sig=abc'
    api.mock('POST /v1/contact-uploads/presign', {
      status: 200,
      data: {
        uploadId: 'upload-1',
        uploadUrl: S3_PUT_URL,
        expiresAt: '2026-10-01T12:15:00.000Z',
      },
    })
    mswServer.use(
      http.put(S3_PUT_URL, async () => {
        await putDone
        return new HttpResponse(null, { status: 200 })
      }),
    )
    api.mock('POST /v1/contact-uploads/:id/uploaded', {
      status: 200,
      data: makeUpload({ status: 'processing', rowCount: null }),
    })
  }

  it('says the file is uploading while it is sent', async () => {
    let finishPut: (() => void) | undefined
    mockSuccessfulUpload(
      new Promise<void>((resolve) => {
        finishPut = resolve
      }),
    )
    const user = userEvent.setup()
    renderWizard(vi.fn(), true)

    await importNewsletter(user)

    expect(
      await screen.findByRole('heading', { name: 'Uploading your file' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Sending 2 people')).toBeInTheDocument()
    expect(screen.queryByText(/Importing/)).not.toBeInTheDocument()
    finishPut?.()
    await waitFor(() => expect(router.push).toHaveBeenCalled())
  })

  it('stays open on the uploading screen until Upload history is the route', async () => {
    mockSuccessfulUpload()
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <ImportContactsWizard open onOpenChange={onOpenChange} isWin={false} />,
    )

    await importNewsletter(user)

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads'),
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(
      screen.getByRole('heading', { name: 'Uploading your file' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Import 2 people' }),
    ).not.toBeInTheDocument()

    vi.mocked(usePathname).mockReturnValue('/dashboard/contacts/uploads')
    rerender(
      <ImportContactsWizard open onOpenChange={onOpenChange} isWin={false} />,
    )

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('closes once the upload is sent when opened from Upload history', async () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/contacts/uploads')
    mockSuccessfulUpload()
    const user = userEvent.setup()
    const onOpenChange = renderWizard()

    await importNewsletter(user)

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/uploads')
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.ImportAbandoned,
      expect.anything(),
    )
  })

  it('does not confirm the upload when the S3 put fails', async () => {
    const S3_PUT_URL = 'https://s3.example/put?sig=abc'
    api.mock('POST /v1/contact-uploads/presign', {
      status: 200,
      data: {
        uploadId: 'upload-1',
        uploadUrl: S3_PUT_URL,
        expiresAt: '2026-10-01T12:15:00.000Z',
      },
    })
    mswServer.use(
      http.put(S3_PUT_URL, () => new HttpResponse(null, { status: 403 })),
    )
    const confirm = vi.fn(() => ({
      status: 200 as const,
      data: makeUpload({ status: 'processing' }),
    }))
    api.mock('POST /v1/contact-uploads/:id/uploaded', confirm)
    const user = userEvent.setup()
    renderWizard()

    await chooseFile(user, NEWSLETTER)
    await screen.findByText(/2 people found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Upload name'), 'Newsletter')
    await user.click(
      screen.getByLabelText(
        'These people agreed to hear from me. I am responsible for that.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Import 2 people' }))

    expect(
      await screen.findByText(
        "We couldn't import this file. Check it and try again.",
      ),
    ).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('records where the user left off when the wizard closes early', async () => {
    const user = userEvent.setup()
    const onOpenChange = renderWizard(vi.fn(), true)

    await chooseFile(user, NEWSLETTER)
    await screen.findByText(/2 people found/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Contacts.ImportAbandoned, {
      lastStep: 'columns',
      rowCount: 2,
      product: 'win',
    })
  })
})
