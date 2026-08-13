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

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    infoSnackbar: vi.fn(),
  }),
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

import { clientRequest } from 'gpApi/typed-request'
import PublicProfileEditor from './PublicProfileEditor'

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
  mockedRequest.mockResolvedValue({
    ok: true,
    status: 200,
    data: profile(),
  } as never)
})

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
