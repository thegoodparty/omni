import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { TeamMember, PendingInvite } from 'gpApi/api-endpoints'
import TeamPage from './TeamPage'

const { mockUseOrganization, mockUseOrganizationRole } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockUseOrganizationRole: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
  useOrganizationRole: () => mockUseOrganizationRole(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

// DashboardLayout pulls in the whole dashboard shell (menu, campaign context,
// sidebar); this file is only about TeamPage's own data/role behavior, so it
// renders as a pass-through, same convention as CrmContactsPage.test.tsx.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

const owner: TeamMember = {
  userId: 1,
  name: 'Owner Person',
  email: 'owner@example.com',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
}

const manager: TeamMember = {
  userId: 2,
  name: 'Manager Person',
  email: 'manager@example.com',
  role: 'campaignAdmin',
  createdAt: '2024-01-02T00:00:00.000Z',
}

const pendingInvite: PendingInvite = {
  id: 'invite-1',
  name: 'Invitee Person',
  email: 'invitee@example.com',
  role: 'campaignAdmin',
  createdAt: '2024-01-03T00:00:00.000Z',
  outreachId: null,
}

const pendingInvite2: PendingInvite = {
  id: 'invite-2',
  name: 'Second Invitee',
  email: 'second-invitee@example.com',
  role: 'campaignAdmin',
  createdAt: '2024-01-04T00:00:00.000Z',
  outreachId: null,
}

// Mutable so DELETE mock handlers can simulate a real backend: a mutation's
// onSuccess triggers a GET refetch (invalidateTeam), and that refetch has to
// reflect the mutation or "removes it from the list without a reload" isn't a
// real assertion — it would pass even if the mutation never fired.
let members: TeamMember[]
let pendingInvites: PendingInvite[]

beforeEach(() => {
  testQueryClient.clear()
  mockUseOrganization.mockReturnValue({ slug: 'campaign-1' })
  mockUseOrganizationRole.mockReturnValue('owner')
  members = [owner, manager]
  pendingInvites = [pendingInvite]
  api.mock('GET /v1/organizations/team', () => ({
    status: 200,
    data: { members, pendingInvites },
  }))
})

describe('TeamPage — members and pending invites', () => {
  it('renders members and pending invites from the team endpoint', async () => {
    render(<TeamPage />)

    expect(await screen.findByText('Owner Person')).toBeInTheDocument()
    expect(screen.getByText('Manager Person')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    // The manager row and the pending invite both carry the campaignAdmin
    // role in this fixture, so both render the same label — plus one more
    // from the "How roles work" card's own "Campaign Manager" (ENG-11058).
    expect(screen.getAllByText('Campaign Manager').length).toBe(3)
    expect(screen.getByText('Invitee Person')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByText('2 people on this campaign')).toBeInTheDocument()
  })

  it('renders an empty pending-invites state when there are none', async () => {
    members = [owner]
    pendingInvites = []

    render(<TeamPage />)

    expect(
      await screen.findByText('1 person on this campaign'),
    ).toBeInTheDocument()
    expect(screen.getByText('No pending invites.')).toBeInTheDocument()
  })
})

describe('TeamPage — elected-office (Serve) orgs are out of scope (ENG-10816 non-goal)', () => {
  it('renders a neutral state and never fetches the team endpoint for an eo- org', async () => {
    mockUseOrganization.mockReturnValue({
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
    })
    let fetched = false
    api.mock('GET /v1/organizations/team', () => {
      fetched = true
      return { status: 200, data: { members: [owner], pendingInvites: [] } }
    })

    render(<TeamPage />)

    expect(
      await screen.findByText(
        'Team accounts aren’t available for elected offices yet.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Invite')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(fetched).toBe(false)
  })
})

describe('TeamPage — owner vs manager affordances', () => {
  it('gives the owner a Manage action on a manager row but not on their own', async () => {
    mockUseOrganizationRole.mockReturnValue('owner')
    render(<TeamPage />)

    await screen.findByText('Manager Person')
    expect(
      screen.getByRole('button', { name: 'Manage Manager Person' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Manage Owner Person' }),
    ).not.toBeInTheDocument()
  })

  it('gives a manager no Manage action on any row', async () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    render(<TeamPage />)

    await screen.findByText('Manager Person')
    expect(
      screen.queryByRole('button', { name: /^Manage /i }),
    ).not.toBeInTheDocument()
  })

  it('removes a member when the owner confirms via the Manage menu', async () => {
    const user = userEvent.setup()
    mockUseOrganizationRole.mockReturnValue('owner')
    api.mock('DELETE /v1/organizations/team/members/:userId', () => {
      members = members.filter((m) => m.userId !== manager.userId)
      return { status: 200, data: undefined }
    })
    render(<TeamPage />)

    await screen.findByText('Manager Person')
    await user.click(
      screen.getByRole('button', { name: 'Manage Manager Person' }),
    )
    await user.click(await screen.findByText('Remove from team'))

    await waitFor(() => {
      expect(screen.queryByText('Manager Person')).not.toBeInTheDocument()
    })
    expect(screen.getByText('1 person on this campaign')).toBeInTheDocument()
  })
})

describe('TeamPage — invite flow (ENG-11058 two-step drawer)', () => {
  it('walks step 1 -> step 2, posts the picked role, phone omitted when blank', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown
    api.mock('POST /v1/organizations/team/invites', (req) => {
      capturedBody = req.body
      return {
        status: 200,
        data: {
          status: 'pending',
          invite: {
            id: 'new-invite',
            email: req.body.email,
            name: req.body.name,
            role: req.body.role,
            createdAt: '2024-01-04T00:00:00.000Z',
            outreachId: null,
          },
        },
      }
    })

    render(<TeamPage />)
    await screen.findByText('Owner Person')

    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(
      await screen.findByText('Who do you want to invite?'),
    ).toBeInTheDocument()
    // Continue is disabled until both required fields are filled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('What role would you like to assign?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Volunteer/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() => {
      expect(capturedBody).toEqual({
        email: 'new@example.com',
        name: 'New Person',
        role: 'volunteer',
      })
    })
    await waitFor(() => {
      expect(
        screen.queryByText('Who do you want to invite?'),
      ).not.toBeInTheDocument()
    })
  })

  it('carries an entered phone number through to the request', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown
    api.mock('POST /v1/organizations/team/invites', (req) => {
      capturedBody = req.body
      return {
        status: 200,
        data: {
          status: 'pending',
          invite: {
            id: 'new-invite',
            email: req.body.email,
            name: req.body.name,
            role: req.body.role,
            createdAt: '2024-01-04T00:00:00.000Z',
            outreachId: null,
          },
        },
      }
    })

    render(<TeamPage />)
    await screen.findByText('Owner Person')

    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Phone number'), '2025551234')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Campaign Manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() => {
      expect(capturedBody).toEqual({
        email: 'new@example.com',
        name: 'New Person',
        role: 'campaignAdmin',
        phone: '2025551234',
      })
    })
  })

  it('Back from step 2 returns to step 1 with the entered values intact', async () => {
    const user = userEvent.setup()
    render(<TeamPage />)
    await screen.findByText('Owner Person')

    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('What role would you like to assign?')

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(
      await screen.findByText('Who do you want to invite?'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('New Person')
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com')
  })

  it('shows the 409 message inline instead of closing the drawer', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/organizations/team/invites', {
      status: 409,
      data: { message: 'An invitation is already pending for this email' },
    })

    render(<TeamPage />)
    await screen.findByText('Owner Person')

    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Campaign Manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(
      await screen.findByText(
        'An invitation is already pending for this email',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What role would you like to assign?'),
    ).toBeInTheDocument()
  })

  // ENG-11058 delegate fix: an invalid phone 400s via PhoneSchema server-side
  // (InviteTeamMemberDto) — that message must surface inline too, not just
  // the generic fallback the 409-only check used to leave it with.
  // ENG-11058 delegate fix (round 2): a 400 is InviteTeamMemberDto's own
  // validation (e.g. an invalid phone via PhoneSchema) — the field it's
  // about lives on step 1, so the message has to navigate back there rather
  // than render on step 2 with no phone field in sight.
  it('shows the 400 message and navigates back to step 1, where the phone field lives', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/organizations/team/invites', {
      status: 400,
      // The real nestjs-zod v5 ZodValidationException shape: a static
      // "Validation failed" message with the field copy in errors[].
      data: {
        message: 'Validation failed',
        errors: [
          {
            code: 'custom',
            message: 'Must be valid phone number',
            path: ['phone'],
          },
        ],
      },
    })

    render(<TeamPage />)
    await screen.findByText('Owner Person')

    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Phone number'), 'abc')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Campaign Manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(
      await screen.findByText('Must be valid phone number'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Who do you want to invite?'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('What role would you like to assign?'),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Phone number')).toHaveValue('abc')
  })
})

describe('TeamPage — "How roles work" card (ENG-11058)', () => {
  it('states both locked role descriptions', async () => {
    render(<TeamPage />)
    await screen.findByText('Owner Person')

    expect(screen.getByText('How roles work')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Runs everything on the campaign except billing and account settings\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Runs door knocking or phone banking outreach campaigns only\./,
      ),
    ).toBeInTheDocument()
  })
})

describe('TeamPage — loading and error states (ENG-11039)', () => {
  it('shows skeletons, never a count or a bare member table, before the fetch resolves', async () => {
    let resolveTeam: (() => void) | undefined
    api.mock(
      'GET /v1/organizations/team',
      () =>
        new Promise((resolve) => {
          resolveTeam = () =>
            resolve({ status: 200, data: { members, pendingInvites } })
        }),
    )

    const { container } = render(<TeamPage />)

    expect(
      screen.queryByText(/people on this campaign|person on this campaign/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Owner Person')).not.toBeInTheDocument()
    expect(screen.queryByText('Invitee Person')).not.toBeInTheDocument()
    // Heading skeleton + the members table's skeleton row + the pending
    // invites table's skeleton row.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(3)

    await waitFor(() => expect(resolveTeam).toBeDefined())
    resolveTeam?.()
    expect(
      await screen.findByText('2 people on this campaign'),
    ).toBeInTheDocument()
  })

  // ENG-11039: the specific bug window — orgSlug not yet resolved so the
  // query is disabled (enabled: false). In React Query v5 isPending is true
  // for a disabled query but isFetching is false, so the old isLoading check
  // returned false and rendered a bare empty table instead of skeletons.
  it('shows skeletons when orgSlug is not yet resolved (query disabled window)', () => {
    mockUseOrganization.mockReturnValue(undefined)

    const { container } = render(<TeamPage />)

    expect(
      screen.queryByText(/people on this campaign|person on this campaign/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Owner Person')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(3)
  })

  it('shows an error message and no fabricated count or table when the team fetch fails', async () => {
    api.mock('GET /v1/organizations/team', {
      status: 500,
      data: { message: 'upstream error' },
    })

    render(<TeamPage />)

    expect(
      await screen.findByText(
        'Couldn’t load your team. Try refreshing the page.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/people on this campaign|person on this campaign/),
    ).not.toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('No pending invites.')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Couldn’t load pending invites. Try refreshing the page.',
      ),
    ).toBeInTheDocument()
  })
})

describe('TeamPage — role change (ENG-11049)', () => {
  it('offers Make Volunteer on a manager row and PATCHes the right value', async () => {
    const user = userEvent.setup()
    let patchBody: unknown
    let patchedUserId: string | undefined
    api.mock(
      'PATCH /v1/organizations/team/members/:userId',
      ({ params, body }) => {
        patchedUserId = params.userId
        patchBody = body
        members = members.map((m) =>
          m.userId === manager.userId ? { ...m, role: 'volunteer' } : m,
        )
        return { status: 200, data: { ...manager, role: 'volunteer' } }
      },
    )
    render(<TeamPage />)

    await screen.findByText('Manager Person')
    await user.click(
      screen.getByRole('button', { name: 'Manage Manager Person' }),
    )
    await user.click(await screen.findByText('Make Volunteer'))

    await waitFor(() => {
      expect(patchedUserId).toBe(String(manager.userId))
      expect(patchBody).toEqual({ role: 'volunteer' })
    })
    // Scoped to the row: the "How roles work" card (ENG-11058) also reads
    // "Volunteer" verbatim, so an unscoped findByText now matches twice.
    const row = (await screen.findByText('Manager Person')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('Volunteer')).toBeInTheDocument()
  })

  it('offers Make Campaign Manager on a volunteer row and PATCHes the right value', async () => {
    const user = userEvent.setup()
    const volunteer: TeamMember = {
      userId: 3,
      name: 'Val Volunteer',
      email: 'val@example.com',
      role: 'volunteer',
      createdAt: '2024-01-05T00:00:00.000Z',
    }
    members = [owner, volunteer]
    pendingInvites = []
    let patchBody: unknown
    api.mock('PATCH /v1/organizations/team/members/:userId', ({ body }) => {
      patchBody = body
      members = members.map((m) =>
        m.userId === volunteer.userId ? { ...m, role: 'campaignAdmin' } : m,
      )
      return { status: 200, data: { ...volunteer, role: 'campaignAdmin' } }
    })
    render(<TeamPage />)

    await screen.findByText('Val Volunteer')
    await user.click(
      screen.getByRole('button', { name: 'Manage Val Volunteer' }),
    )
    await user.click(await screen.findByText('Make Campaign Manager'))

    await waitFor(() => {
      expect(patchBody).toEqual({ role: 'campaignAdmin' })
    })
    // Scoped to the row: the "How roles work" card (ENG-11058) also reads
    // "Campaign Manager" verbatim, so an unscoped findByText now matches
    // more than once.
    const row = (await screen.findByText('Val Volunteer')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('Campaign Manager')).toBeInTheDocument()
  })

  it('never offers a role-change action to a manager (no Manage menu at all)', async () => {
    mockUseOrganizationRole.mockReturnValue('campaignAdmin')
    render(<TeamPage />)

    await screen.findByText('Manager Person')
    expect(screen.queryByText('Make Volunteer')).not.toBeInTheDocument()
    expect(screen.queryByText('Make Campaign Manager')).not.toBeInTheDocument()
  })
})

describe('TeamPage — revoking a pending invite', () => {
  it('revokes the invite and removes it from the list without a reload', async () => {
    const user = userEvent.setup()
    api.mock('DELETE /v1/organizations/team/invites/:id', () => {
      pendingInvites = pendingInvites.filter((i) => i.id !== pendingInvite.id)
      return { status: 200, data: undefined }
    })

    render(<TeamPage />)
    await screen.findByText('Invitee Person')

    await user.click(
      screen.getByRole('button', {
        name: 'Revoke invite for invitee@example.com',
      }),
    )

    await waitFor(() => {
      expect(screen.queryByText('Invitee Person')).not.toBeInTheDocument()
    })
    expect(screen.getByText('No pending invites.')).toBeInTheDocument()
  })

  // One shared revokeMutation instance backs every row (delegate review, PR
  // #1688) — disabling on isPending alone would lock out every OTHER
  // pending invite's button while any one revoke is in flight. Proving that
  // needs two pending invites and a revoke that doesn't resolve until this
  // test says so.
  it('disables only the row being revoked, leaving other pending invites revokable', async () => {
    const user = userEvent.setup()
    pendingInvites = [pendingInvite, pendingInvite2]
    let resolveRevoke: (() => void) | undefined
    api.mock(
      'DELETE /v1/organizations/team/invites/:id',
      (req) =>
        new Promise((resolve) => {
          resolveRevoke = () => {
            pendingInvites = pendingInvites.filter(
              (i) => i.id !== req.params.id,
            )
            resolve({ status: 200, data: undefined })
          }
        }),
    )

    render(<TeamPage />)
    await screen.findByText('Invitee Person')
    await screen.findByText('Second Invitee')

    const firstRevoke = screen.getByRole('button', {
      name: 'Revoke invite for invitee@example.com',
    })
    const secondRevoke = screen.getByRole('button', {
      name: 'Revoke invite for second-invitee@example.com',
    })

    await user.click(firstRevoke)

    await waitFor(() => expect(firstRevoke).toBeDisabled())
    expect(secondRevoke).not.toBeDisabled()

    resolveRevoke?.()
    await waitFor(() => {
      expect(screen.queryByText('Invitee Person')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Second Invitee')).toBeInTheDocument()
  })
})

// Delegate review (PR #1736): a list-scoped volunteer invite still belongs
// in this table (the ticket's own AC), but revoking it here has no outreach
// context — that action lives with the drawer's Assignees section instead.
describe('TeamPage — list-scoped pending invites (delegate review, PR #1736)', () => {
  it('renders a list-scoped invite with a Volunteer + list-scoped label and no Revoke button, while a plain invite keeps its Revoke button', async () => {
    const listScopedInvite: PendingInvite = {
      id: 'invite-scoped',
      name: 'Val Volunteer',
      email: 'val@example.com',
      role: 'volunteer',
      createdAt: '2024-01-06T00:00:00.000Z',
      outreachId: 30,
    }
    pendingInvites = [pendingInvite, listScopedInvite]

    render(<TeamPage />)

    await screen.findByText('Val Volunteer')
    const scopedRow = screen.getByText('Val Volunteer').closest('tr')
    expect(scopedRow).not.toBeNull()
    expect(within(scopedRow!).getByText('Volunteer')).toBeInTheDocument()
    expect(within(scopedRow!).getByText('List-scoped')).toBeInTheDocument()
    expect(
      within(scopedRow!).queryByRole('button', { name: /Revoke invite/ }),
    ).not.toBeInTheDocument()

    // The plain (non-list-scoped) invite is untouched.
    expect(
      screen.getByRole('button', {
        name: 'Revoke invite for invitee@example.com',
      }),
    ).toBeInTheDocument()
  })
})
