import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { Priority } from '@goodparty_org/contracts'
import type { PersonProfile } from '../shared/types'

// The editor's every mutation goes through the typed client; asserting the exact
// endpoint + payload is the point of these tests (the network itself is covered
// by the gp-api e2e).
vi.mock('gpApi/typed-request', () => ({
  clientRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}))

// Stable across renders so a failed save's message can be asserted; a fresh
// vi.fn() per render would be unreachable from the test body.
const { errorSnackbar, successSnackbar } = vi.hoisted(() => ({
  errorSnackbar: vi.fn(),
  successSnackbar: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar,
    successSnackbar,
    infoSnackbar: vi.fn(),
  }),
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

import { clientRequest } from 'gpApi/typed-request'
import PublicProfileEditor, { FORM_KEYS } from './PublicProfileEditor'
import { fieldLabel } from './publicProfileValidation'

const mockedRequest = vi.mocked(clientRequest)

const profile = (overrides: Partial<PersonProfile> = {}): PersonProfile =>
  ({
    personId: 'person-1',
    displayName: 'Jane Rivera',
    roleTitleOverride: null,
    bioOverride: null,
    whyRunning: null,
    publicEmail: null,
    publicPhone: null,
    officePhone: null,
    websiteUrl: null,
    governmentWebsiteUrl: null,
    instagramUrl: null,
    tiktokUrl: null,
    facebookUrl: null,
    twitterUrl: null,
    linkedinUrl: null,
    avatarUrl: null,
    coverImageUrl: null,
    recentExperience: [],
    accomplishments: [],
    issues: [],
    publishedAt: null,
    deletedAt: null,
    ...overrides,
  }) as unknown as PersonProfile

const priority = (id: string, title: string): Priority =>
  ({ id, title, description: `${title} description` }) as unknown as Priority

beforeEach(() => {
  mockedRequest.mockReset()
  errorSnackbar.mockReset()
  successSnackbar.mockReset()
  mockedRequest.mockResolvedValue({
    ok: true,
    status: 200,
    data: profile(),
  } as never)
})

const save = async (): Promise<void> =>
  userEvent.click(screen.getAllByRole('button', { name: /save changes/i })[0]!)

const putPayloads = (): Array<Record<string, unknown>> =>
  mockedRequest.mock.calls
    .filter(([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine')
    .map(([, body]) => body as Record<string, unknown>)

const putPayload = (): Record<string, unknown> | undefined =>
  mockedRequest.mock.calls.find(
    ([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine',
  )?.[1] as Record<string, unknown> | undefined

describe('PublicProfileEditor — pre-profile states', () => {
  it('shows the "setting up" copy (no CTA) when the person has no canonical id yet', () => {
    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={null}
        canCreate={false}
        priorities={[]}
      />,
    )
    expect(
      screen.getByText(/still setting up your official record/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /create my public profile/i }),
    ).not.toBeInTheDocument()
  })

  it('creates the profile via POST when canCreate is true', async () => {
    mockedRequest.mockResolvedValue({
      ok: true,
      status: 201,
      data: profile({ displayName: 'Jane Rivera' }),
    } as never)

    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={null}
        canCreate
        priorities={[]}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /create my public profile/i }),
    )

    expect(mockedRequest).toHaveBeenCalledWith('POST /v1/person-profiles', {})
    // The created profile swaps the shell for the loaded editor. Asserted on
    // the first section heading, not a page title: the page's h1 lives in the
    // shared title bar DashboardLayout renders, not in this component.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /^identity$/i }),
      ).toBeInTheDocument(),
    )
  })
})

describe('PublicProfileEditor — product framing (serve vs win)', () => {
  it('serve: uses "Why I serve" and shows the Top priorities card', () => {
    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )
    expect(screen.getByLabelText('Why I serve')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /top priorities/i }),
    ).toBeInTheDocument()
  })

  it('win: uses "Why I\'m running" and hides the Top priorities card', () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )
    expect(screen.getByLabelText("Why I'm running")).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /top priorities/i }),
    ).not.toBeInTheDocument()
  })
})

// The whole profile is one payload, so a malformed contact field used to reject
// every other edit with a generic "try again" — advice that could never work,
// because the value was the problem. These pin the field-level reporting.
describe('PublicProfileEditor — contact validation', () => {
  const renderEditor = (overrides: Partial<PersonProfile> = {}): void => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile(overrides)}
        canCreate
        priorities={[]}
      />,
    )
  }

  it('blocks the save and names the field when the email has no @', async () => {
    renderEditor()
    await userEvent.type(
      screen.getByLabelText('Public email'),
      'thomasquocthainguyen.com',
    )
    await save()

    expect(putPayload()).toBeUndefined()
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument()
    expect(errorSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('Public email'),
    )
  })

  it('leaves a blank email alone, since clearing a field is not an error', async () => {
    renderEditor()
    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    // Untouched and blank, so it is simply not part of the patch.
    expect('publicEmail' in putPayload()!).toBe(false)
  })

  it('adds the scheme a bare link omits rather than rejecting it', async () => {
    renderEditor()
    await userEvent.type(
      screen.getByLabelText('Instagram'),
      'instagram.com/thomasqtnguyen',
    )
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    expect(putPayload()!.instagramUrl).toBe(
      'https://instagram.com/thomasqtnguyen',
    )
  })

  it('keeps an explicit http:// link as typed', async () => {
    renderEditor()
    await userEvent.type(
      screen.getByLabelText('Personal website'),
      'http://example.org',
    )
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    expect(putPayload()!.websiteUrl).toBe('http://example.org')
  })

  it('clears the message once the field is corrected', async () => {
    renderEditor()
    const email = screen.getByLabelText('Public email')
    await userEvent.type(email, 'nope')
    await save()
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument()

    await userEvent.type(email, '@example.com')
    expect(
      screen.queryByText(/enter a valid email address/i),
    ).not.toBeInTheDocument()
  })

  it('surfaces the field the server rejected instead of a generic message', async () => {
    renderEditor()
    mockedRequest.mockRejectedValue(
      Object.assign(new Error('Bad Request'), {
        status: 400,
        data: {
          statusCode: 400,
          message: 'Validation failed',
          errors: [
            {
              code: 'invalid_string',
              path: ['publicEmail'],
              message: 'Invalid email address',
            },
          ],
        },
      }),
    )

    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()

    await waitFor(() =>
      expect(screen.getByText('Invalid email address')).toBeInTheDocument(),
    )
    expect(errorSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('Public email'),
    )
  })

  it('falls back to the generic message when the failure names no field', async () => {
    renderEditor()
    mockedRequest.mockRejectedValue(
      Object.assign(new Error('Server Error'), { status: 500, data: {} }),
    )

    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        "Couldn't save your profile. Please try again.",
      ),
    )
  })
})

// Reported as "we saved the socials and the website disappeared". The editor
// used to PUT all fourteen fields from a snapshot taken at mount, so any value
// not in that snapshot was sent as null and destroyed.
describe('PublicProfileEditor — partial saves', () => {
  it('omits fields the user never touched, instead of nulling them', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({
          websiteUrl: 'https://thomasnguyen.com',
          publicEmail: 'thomas@example.com',
        })}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(
      screen.getByLabelText('Instagram'),
      'https://instagram.com/thomasqtnguyen',
    )
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    const body = putPayload()!
    expect(body.instagramUrl).toBe('https://instagram.com/thomasqtnguyen')
    // The two it never touched must not appear at all — present-and-null is
    // exactly the delete this test exists to prevent.
    expect('websiteUrl' in body).toBe(false)
    expect('publicEmail' in body).toBe(false)
  })

  it('still sends an explicit null when the user clears a field on purpose', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ websiteUrl: 'https://thomasnguyen.com' })}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.clear(screen.getByLabelText('Personal website'))
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    const body = putPayload()!
    expect('websiteUrl' in body).toBe(true)
    expect(body.websiteUrl).toBeNull()
  })

  // The columns carry no DB constraint, so a value the write schema would
  // reject can be stored by any path that skips it. Sending and validating the
  // whole form let one such value reject every unrelated edit, with no way for
  // the owner to clear it. Guarded rather than observed: an audit of prod found
  // no profile currently in this state, and the point is that it stays that way.
  it('saves an unrelated edit even when an untouched stored field is invalid', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ publicEmail: 'thomasquocthainguyen.com' })}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    expect(putPayload()!.whyRunning).toBe('Parks')
    expect('publicEmail' in putPayload()!).toBe(false)
  })

  // Normalization adds `https://`, so a scheme-less stored link would look
  // edited if the diff compared a normalized form against a raw baseline. It
  // would then be rewritten without being asked, and — once it fails
  // validation — take the rest of the save down with it.
  it('does not send or judge an untouched link that has no scheme', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({
          instagramUrl: 'instagram.com/jane',
          websiteUrl: 'not a url',
        })}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    const body = putPayload()!
    expect(body.whyRunning).toBe('Parks')
    expect('instagramUrl' in body).toBe(false)
    expect('websiteUrl' in body).toBe(false)
  })

  it('still lets the owner repair such a link by editing it', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ instagramUrl: 'instagram.com/jane' })}
        canCreate
        priorities={[]}
      />,
    )

    const field = screen.getByLabelText('Instagram')
    await userEvent.clear(field)
    await userEvent.type(field, 'instagram.com/jane')
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    expect(putPayload()!.instagramUrl).toBe('https://instagram.com/jane')
  })

  it('makes no request when nothing changed', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ websiteUrl: 'https://thomasnguyen.com' })}
        canCreate
        priorities={[]}
      />,
    )

    await save()

    expect(putPayload()).toBeUndefined()
  })

  it('rebases after a save, so a second edit does not resend the first', async () => {
    const saved = profile({ whyRunning: 'Parks' })
    mockedRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: saved,
    } as never)

    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText("Why I'm running"), 'Parks')
    await save()
    await waitFor(() => expect(putPayload()).toBeDefined())

    mockedRequest.mockClear()
    await userEvent.type(screen.getByLabelText('Instagram'), 'https://x.com/a')
    await save()

    await waitFor(() => expect(putPayload()).toBeDefined())
    expect('whyRunning' in putPayload()!).toBe(false)
  })

  // The client only pre-validates emails and links, so every other column
  // reaches the server and can come back rejected. Naming it by column tells
  // the owner to check something the page does not contain.
  it('names a server-rejected field as the form labels it', async () => {
    mockedRequest.mockRejectedValue({
      data: { errors: [{ path: ['displayName'], message: 'Too long' }] },
    })

    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText('Display name'), '!')
    await save()

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Check Display name and save again.',
      ),
    )
  })

  it('uses the serve wording when that is what the owner is looking at', async () => {
    mockedRequest.mockRejectedValue({
      data: { errors: [{ path: ['whyRunning'], message: 'Too long' }] },
    })

    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText('Why I serve'), 'Parks')
    await save()

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Check Why I serve and save again.',
      ),
    )
  })

  // The lists are diffed after the blank-row filter, so a half-started row the
  // owner left behind is neither sent nor mistaken for a change on every save
  // that follows. It stays on screen, because it is still theirs to finish.
  it('does not resend a list because of a blank row left in the form', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: /add experience/i }),
    )
    await userEvent.type(screen.getByLabelText('Display name'), '!')
    await save()
    await waitFor(() => expect(putPayloads()).toHaveLength(1))
    expect('recentExperience' in putPayloads()[0]!).toBe(false)

    await userEvent.type(screen.getByLabelText('Instagram'), 'https://x.com/a')
    await save()

    await waitFor(() => expect(putPayloads()).toHaveLength(2))
    expect(Object.keys(putPayloads()[1]!)).toEqual(['instagramUrl'])
  })

  it('does not resend a stored list after a save that round-trips it', async () => {
    const withExperience = profile({
      recentExperience: [{ title: 'Teacher', organization: 'Ward 3 Schools' }],
    })
    mockedRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: withExperience,
    } as never)

    render(
      <PublicProfileEditor
        product="win"
        initialProfile={withExperience}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText('Display name'), '!')
    await save()
    await waitFor(() => expect(putPayloads()).toHaveLength(1))

    await userEvent.type(screen.getByLabelText('Instagram'), 'https://x.com/a')
    await save()

    await waitFor(() => expect(putPayloads()).toHaveLength(2))
    expect(Object.keys(putPayloads()[1]!)).toEqual(['instagramUrl'])
  })

  // Everything else about normalization is asserted through a save, which
  // re-normalizes on the way out — so those tests would still pass with the blur
  // handler deleted. These two are the only cover the blur path has.
  it('shows the scheme it will store while the owner is still on the field', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    const instagram = screen.getByLabelText('Instagram')
    await userEvent.type(instagram, 'instagram.com/jane')
    await userEvent.tab()

    expect(instagram).toHaveValue('https://instagram.com/jane')
    expect(putPayload()).toBeUndefined()
  })

  it('leaves a stored link alone when the owner only tabs through it', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ instagramUrl: 'instagram.com/jane' })}
        canCreate
        priorities={[]}
      />,
    )

    const instagram = screen.getByLabelText('Instagram')
    await userEvent.click(instagram)
    await userEvent.tab()

    expect(instagram).toHaveValue('instagram.com/jane')
  })

  it('marks a server-rejected textarea, so the field is findable after the toast goes', async () => {
    mockedRequest.mockRejectedValue({
      data: { errors: [{ path: ['bioOverride'], message: 'Too long' }] },
    })

    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    await userEvent.type(screen.getByLabelText('About me'), 'Hi')
    await save()

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Too long'),
    )
    expect(screen.getByLabelText('About me')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('has a label for every field it can send', () => {
    const missing = FORM_KEYS.filter(
      (key) => fieldLabel(key, 'win') === (key as string),
    )
    expect(missing).toEqual([])
  })
})

describe('PublicProfileEditor — mutations', () => {
  it('saves edited fields to PUT /mine', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )
    const why = screen.getByLabelText("Why I'm running")
    await userEvent.type(why, 'Safer streets')
    await userEvent.click(
      screen.getAllByRole('button', { name: /save changes/i })[0]!,
    )

    await waitFor(() => expect(mockedRequest).toHaveBeenCalled())
    const put = mockedRequest.mock.calls.find(
      ([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine',
    )
    expect(put).toBeDefined()
    expect((put![1] as { whyRunning: string }).whyRunning).toBe('Safer streets')
  })

  it('publishes via the header toggle', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )
    // Win has no priorities card, so the only switch is publish (Draft → publish).
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        'POST /v1/person-profiles/mine/publish',
        {},
      ),
    )
  })

  it('unpublishes a published profile via the header toggle', async () => {
    render(
      <PublicProfileEditor
        product="win"
        initialProfile={profile({ publishedAt: '2026-01-01T00:00:00.000Z' })}
        canCreate
        priorities={[]}
      />,
    )
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        'POST /v1/person-profiles/mine/unpublish',
        {},
      ),
    )
  })

  it('saves authored Recent Experience and Accomplishments in the PUT payload', async () => {
    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={profile()}
        canCreate
        priorities={[]}
      />,
    )

    // Recent Experience: add a row and fill it. Labels are unique to this editor
    // until an accomplishment row (which also has a "Title") is added below.
    await userEvent.click(
      screen.getByRole('button', { name: /add experience/i }),
    )
    await userEvent.type(screen.getByLabelText('Title'), 'Mayor')
    await userEvent.type(
      screen.getByLabelText('Organization'),
      'City of Springfield',
    )
    await userEvent.type(screen.getByLabelText('Term / dates'), '2020 - 2024')

    // Accomplishments: target the (unique) placeholder to avoid the shared "Title".
    await userEvent.click(
      screen.getByRole('button', { name: /add accomplishment/i }),
    )
    await userEvent.type(
      screen.getByPlaceholderText('Passed the tree-canopy ordinance'),
      'Balanced the budget',
    )

    await userEvent.click(
      screen.getAllByRole('button', { name: /save changes/i })[0]!,
    )

    const put = mockedRequest.mock.calls.find(
      ([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine',
    )
    expect(put).toBeDefined()
    const body = put![1] as {
      recentExperience: unknown[]
      accomplishments: unknown[]
    }
    // Owner-authored experience is tagged source:'user' so the public page can
    // distinguish it from the BallotReady-seeded spine rows.
    expect(body.recentExperience).toEqual([
      {
        title: 'Mayor',
        organization: 'City of Springfield',
        term: '2020 - 2024',
        source: 'user',
      },
    ])
    expect(body.accomplishments).toEqual([
      { title: 'Balanced the budget', description: '', date: '' },
    ])
  })
})

describe('PublicProfileEditor — priorities publication (serve)', () => {
  it('publishes a priority with a live status via PUT /mine/issues', async () => {
    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={profile()}
        canCreate
        priorities={[priority('pri-1', 'Roads')]}
      />,
    )

    // Row starts hidden; the status select is disabled until it's visible.
    const showPublicly = screen
      .getByText('Show publicly')
      .closest('label') as HTMLElement
    await userEvent.click(within(showPublicly).getByRole('switch'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'PRIORITIZED')

    await userEvent.click(
      screen.getByRole('button', { name: /save priorities/i }),
    )

    const put = mockedRequest.mock.calls.find(
      ([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine/issues',
    )
    expect(put).toBeDefined()
    expect((put![1] as { issues: unknown[] }).issues).toEqual([
      { issueId: 'pri-1', visible: true, status: 'PRIORITIZED', sortOrder: 0 },
    ])
  })

  it('persists reordering as sortOrder', async () => {
    render(
      <PublicProfileEditor
        product="serve"
        initialProfile={profile()}
        canCreate
        priorities={[priority('pri-1', 'Roads'), priority('pri-2', 'Parks')]}
      />,
    )

    // Move the first row (Roads) down, so Parks becomes sortOrder 0.
    await userEvent.click(
      screen.getAllByRole('button', { name: /move down/i })[0]!,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /save priorities/i }),
    )

    const put = mockedRequest.mock.calls.find(
      ([endpoint]) => endpoint === 'PUT /v1/person-profiles/mine/issues',
    )
    expect(put).toBeDefined()
    const issues = (
      put![1] as { issues: Array<{ issueId: string; sortOrder: number }> }
    ).issues
    expect(issues.map((i) => [i.issueId, i.sortOrder])).toEqual([
      ['pri-2', 0],
      ['pri-1', 1],
    ])
  })
})
