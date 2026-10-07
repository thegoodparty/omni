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

  // A typed /volunteer URL must never render this shell for an owner/manager
  // — that collapses into the "not an active volunteer org" signal from
  // isActiveOrgVolunteer.
  it('sends a non-volunteer visitor to /home', async () => {
    isActiveOrgVolunteer.mockResolvedValue(false)

    await VolunteerLayout({ children })

    expect(redirect).toHaveBeenCalledWith('/home')
  })

  it('renders the shell for an active volunteer org', async () => {
    isActiveOrgVolunteer.mockResolvedValue(true)

    const result = await VolunteerLayout({ children })

    expect(redirect).not.toHaveBeenCalled()
    expect(result).toBeTruthy()
  })
})
