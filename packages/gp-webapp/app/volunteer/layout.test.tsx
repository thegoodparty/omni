import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect, isActiveOrgVolunteer } = vi.hoisted(() => ({
  redirect: vi.fn(),
  isActiveOrgVolunteer: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@shared/organizations/activeOrgVolunteer.server', () => ({
  isActiveOrgVolunteer,
}))
vi.mock('./VolunteerSidebar', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="volunteer-sidebar">{children}</div>
  ),
}))

import VolunteerLayout from './layout'

const children = <div data-testid="volunteer-children">volunteer content</div>

describe('VolunteerLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A typed /volunteer URL must never render this shell for an owner/manager,
  // or exist at all while win-team-accounts is off — both collapse into the
  // same "not an active volunteer org" signal from isActiveOrgVolunteer.
  it('sends a non-volunteer (or flag-off) visitor to /dashboard', async () => {
    isActiveOrgVolunteer.mockResolvedValue(false)

    await VolunteerLayout({ children })

    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('renders the shell for an active volunteer org', async () => {
    isActiveOrgVolunteer.mockResolvedValue(true)

    const result = await VolunteerLayout({ children })

    expect(redirect).not.toHaveBeenCalled()
    expect(result).toBeTruthy()
  })
})
