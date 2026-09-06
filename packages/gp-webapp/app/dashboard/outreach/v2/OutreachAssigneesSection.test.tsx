import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  OutreachAssignee,
  PendingInvite,
  TeamMember,
} from 'gpApi/api-endpoints'
import { OutreachAssigneesSection } from './OutreachAssigneesSection'

let teamAccountsFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/teamAccountsFlag', () => ({
  useTeamAccountsFlag: () => teamAccountsFlag,
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

const owner: TeamMember = {
  userId: 1,
  name: 'Owner Person',
  email: 'owner@example.com',
  role: 'owner',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const manager: TeamMember = {
  userId: 2,
  name: 'Cam Manager',
  email: 'cam@example.com',
  role: 'campaignAdmin',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const volunteer: TeamMember = {
  userId: 3,
  name: 'Val Volunteer',
  email: 'val@example.com',
  role: 'volunteer',
  createdAt: '2026-08-01T00:00:00.000Z',
}

let members: TeamMember[]
let pendingInvites: PendingInvite[]
let assignees: OutreachAssignee[]

const mockTeam = () =>
  api.mock('GET /v1/organizations/team', () => ({
    status: 200,
    data: { members, pendingInvites },
  }))

const mockAssignees = () =>
  api.mock('GET /v1/outreach/:id/assignments', () => ({
    status: 200,
    data: { assignees },
  }))

beforeEach(() => {
  testQueryClient.clear()
  teamAccountsFlag = { ready: true, enabled: true }
  members = [owner, manager, volunteer]
  pendingInvites = []
  assignees = []
  mockTeam()
  mockAssignees()
})

describe('OutreachAssigneesSection — assign modal (ENG-11059)', () => {
  it('does not render when the flag is off', () => {
    teamAccountsFlag = { ready: true, enabled: false }
    const { container } = render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens a modal titled with the outreach name, listing every org member including the owner', async () => {
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))

    const dialog = await screen.findByRole('dialog', {
      name: 'Assign to GOTV calls',
    })
    expect(within(dialog).getByText('Owner Person')).toBeInTheDocument()
    expect(within(dialog).getByText('Cam Manager')).toBeInTheDocument()
    expect(within(dialog).getByText('Val Volunteer')).toBeInTheDocument()
  })

  // ENG-11070: the modal has no explicit assign/reassign prop, so a list
  // that already has an assignee reopening this same entry point is the
  // signal — the title switches to the reassign phrasing rather than
  // "Assign to", which reads as if nobody were assigned yet.
  it('titles the dialog "Reassign <name>" when the list already has an assignee', async () => {
    assignees = [
      {
        userId: manager.userId,
        name: manager.name,
        role: manager.role,
        createdAt: '2026-08-02T00:00:00.000Z',
        assignedByUserId: owner.userId,
        assignedByName: owner.name,
      },
    ]
    mockAssignees()
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection
        outreachId={30}
        outreachName="Elm Street loop"
      />,
    )

    await screen.findByText('Cam Manager')
    await user.click(screen.getByText('Assign someone'))

    expect(
      await screen.findByRole('dialog', { name: 'Reassign Elm Street loop' }),
    ).toBeInTheDocument()
  })

  // ENG-11070: the role filter must render as independent pill chips (the
  // styleguide `pills` ToggleGroup variant), not the equal-width `outline`
  // segmented control whose min-w-0/flex-1 segments clipped "Campaign
  // Manager" into "Owner" at modal width.
  it('renders the role filter on the pills ToggleGroup variant, not outline', async () => {
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    const allChip = await within(dialog).findByRole('radio', { name: 'All' })

    expect(allChip).toHaveAttribute('data-variant', 'pills')
    expect(
      within(dialog).getByRole('radio', { name: 'Owner' }),
    ).toHaveAttribute('data-variant', 'pills')
    expect(
      within(dialog).getByRole('radio', { name: 'Campaign Manager' }),
    ).toHaveAttribute('data-variant', 'pills')
    expect(
      within(dialog).getByRole('radio', { name: 'Volunteer' }),
    ).toHaveAttribute('data-variant', 'pills')
  })

  it('falls back to generic copy when no outreach name is given', async () => {
    const user = userEvent.setup()
    render(<OutreachAssigneesSection outreachId={30} />)

    await user.click(await screen.findByText('Assign someone'))

    expect(
      await screen.findByRole('dialog', { name: 'Assign to this list' }),
    ).toBeInTheDocument()
  })

  it('filters the roster by role using the ToggleGroup chips, with role labels from ROLE_LABELS only', async () => {
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Owner Person')

    // Never the prototype's outdated "Candidate" / "Campaign Admin" strings.
    expect(within(dialog).queryByText('Candidate')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Campaign Admin')).not.toBeInTheDocument()
    expect(
      within(dialog).getAllByText('Campaign Manager').length,
    ).toBeGreaterThan(0)

    await user.click(within(dialog).getByRole('radio', { name: 'Volunteer' }))

    expect(within(dialog).queryByText('Owner Person')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Cam Manager')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Val Volunteer')).toBeInTheDocument()
  })

  it('filters the roster by search text over name and email', async () => {
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Owner Person')

    await user.type(
      within(dialog).getByPlaceholderText('Search by name, email, or phone'),
      'cam@example.com',
    )

    expect(within(dialog).getByText('Cam Manager')).toBeInTheDocument()
    expect(within(dialog).queryByText('Owner Person')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Val Volunteer')).not.toBeInTheDocument()
  })

  it('assigns an unassigned member by clicking their row', async () => {
    const user = userEvent.setup()
    let assignedBody: unknown
    api.mock('POST /v1/outreach/:id/assignments', ({ body }) => {
      assignedBody = body
      assignees = [
        {
          userId: manager.userId,
          name: manager.name,
          role: manager.role,
          createdAt: '2026-08-02T00:00:00.000Z',
          assignedByUserId: owner.userId,
          assignedByName: owner.name,
        },
      ]
      return { status: 200, data: assignees[0]! }
    })
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('Cam Manager'))

    await waitFor(() =>
      expect(assignedBody).toEqual({ assigneeUserId: manager.userId }),
    )
    // The section's own list picks up the new assignee once invalidated.
    await waitFor(() => {
      expect(screen.getAllByText('Cam Manager').length).toBeGreaterThan(1)
    })
  })

  // The reviewer's blocker: pendingForThis must not be derived from the
  // shared mutation's own isPending/variables, since mutate() only ever
  // reflects the MOST RECENT call — clicking a second row mid-flight would
  // otherwise recompute the first row's pending state off the second row's
  // variables and re-enable it while its own request is still unresolved.
  it('keeps a clicked row disabled until its OWN request settles, even after a second row is clicked while the first is still in flight', async () => {
    const user = userEvent.setup()
    let resolveManagerAssign: (() => void) | undefined
    let resolveVolunteerAssign: (() => void) | undefined
    api.mock(
      'POST /v1/outreach/:id/assignments',
      ({ body }) =>
        new Promise((resolve) => {
          const respond = () =>
            resolve({
              status: 200,
              data: {
                userId: body.assigneeUserId,
                name:
                  body.assigneeUserId === manager.userId
                    ? manager.name
                    : volunteer.name,
                role:
                  body.assigneeUserId === manager.userId
                    ? manager.role
                    : volunteer.role,
                createdAt: '2026-08-02T00:00:00.000Z',
                assignedByUserId: owner.userId,
                assignedByName: owner.name,
              },
            })
          if (body.assigneeUserId === manager.userId) {
            resolveManagerAssign = respond
          } else {
            resolveVolunteerAssign = respond
          }
        }),
    )
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    const managerRow = within(dialog).getByText('Cam Manager').closest('button')
    const volunteerRow = within(dialog)
      .getByText('Val Volunteer')
      .closest('button')
    expect(managerRow).not.toBeNull()
    expect(volunteerRow).not.toBeNull()

    await user.click(managerRow!)
    await waitFor(() => expect(managerRow).toBeDisabled())

    await user.click(volunteerRow!)
    // Manager's own request is still unresolved — it must stay disabled even
    // though a second, different row was clicked in between.
    expect(managerRow).toBeDisabled()
    await waitFor(() => expect(volunteerRow).toBeDisabled())

    await waitFor(() => expect(resolveManagerAssign).toBeDefined())
    resolveManagerAssign?.()
    await waitFor(() => expect(managerRow).not.toBeDisabled())
    // Volunteer's own request is still unresolved — resolving manager's must
    // not re-enable it early either.
    expect(volunteerRow).toBeDisabled()

    resolveVolunteerAssign?.()
    await waitFor(() => expect(volunteerRow).not.toBeDisabled())
  })

  it('unassigns an already-assigned member by clicking their row again, showing a checkmark while assigned', async () => {
    assignees = [
      {
        userId: manager.userId,
        name: manager.name,
        role: manager.role,
        createdAt: '2026-08-02T00:00:00.000Z',
        assignedByUserId: owner.userId,
        assignedByName: owner.name,
      },
    ]
    mockAssignees()
    let removedUserId: string | undefined
    api.mock('DELETE /v1/outreach/:id/assignments/:userId', ({ params }) => {
      removedUserId = params.userId
      assignees = []
      return { status: 200, data: undefined }
    })
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')
    const row = within(dialog).getByText('Cam Manager').closest('button')
    expect(row).not.toBeNull()
    // Already-assigned members render selected with a checkmark icon.
    expect(row!.querySelector('svg')).toBeInTheDocument()

    await user.click(row!)

    await waitFor(() => expect(removedUserId).toBe(String(manager.userId)))
  })

  it('closes the assign modal and opens the invite-a-volunteer dialog from the modal footer', async () => {
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    await screen.findByRole('dialog', { name: 'Assign to GOTV calls' })
    await user.click(screen.getByText('Invite a volunteer'))

    expect(
      await screen.findByRole('dialog', { name: 'Invite a volunteer' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Assign to GOTV calls' }),
      ).not.toBeInTheDocument()
    })
  })

  // The api-mocking harness's error statuses stop at 500 — this stands in
  // for the ENG-11040 Clerk-paging 502 bursts the real endpoint can throw;
  // both are the same client-side isError branch.
  it('surfaces a retry affordance inside the modal when the team fetch fails', async () => {
    api.mock('GET /v1/organizations/team', {
      status: 500,
      data: { message: 'bad gateway' },
    })
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await user.click(await screen.findByText('Assign someone'))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByText("Couldn't load your team."),
    ).toBeInTheDocument()
    const retry = within(dialog).getByRole('button', { name: 'Try again' })

    mockTeam()
    await user.click(retry)

    expect(await within(dialog).findByText('Owner Person')).toBeInTheDocument()
  })

  it('removes an assignee from the section card via the overflow menu, after confirming', async () => {
    assignees = [
      {
        userId: manager.userId,
        name: manager.name,
        role: manager.role,
        createdAt: '2026-08-02T00:00:00.000Z',
        assignedByUserId: owner.userId,
        assignedByName: owner.name,
      },
    ]
    mockAssignees()
    let removedUserId: string | undefined
    api.mock('DELETE /v1/outreach/:id/assignments/:userId', ({ params }) => {
      removedUserId = params.userId
      return { status: 200, data: undefined }
    })
    const user = userEvent.setup()
    render(
      <OutreachAssigneesSection outreachId={30} outreachName="GOTV calls" />,
    )

    await screen.findByText('Cam Manager')
    await user.click(screen.getByRole('button', { name: 'Manage Cam Manager' }))
    await user.click(await screen.findByText('Remove'))
    const confirmDialog = await screen.findByRole('alertdialog')
    await user.click(
      within(confirmDialog).getByRole('button', { name: 'Remove' }),
    )

    await waitFor(() => expect(removedUserId).toBe(String(manager.userId)))
  })
})
