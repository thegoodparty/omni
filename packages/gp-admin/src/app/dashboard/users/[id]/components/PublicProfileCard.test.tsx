import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@/shared/gpApi'
import { UserProvider } from '../context/UserContext'
import { PublicProfileCard } from './PublicProfileCard'

const PERSON_ID = '474a5caa-fd74-5bf6-4dd8-3ffcc114fcee'
const PROFILE_URL = 'https://goodparty.org/people/joshua-santeramo-474a5caa'

const mockUseAuth = vi.fn()
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  ClerkLoading: () => null,
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const mockGetLink = vi.fn()
const mockFind = vi.fn()
const mockLink = vi.fn()
vi.mock('../publicProfile.actions', () => ({
  getPublicProfileLink: (...args: unknown[]) => mockGetLink(...args),
  findPublicProfile: (...args: unknown[]) => mockFind(...args),
  linkPublicProfile: (...args: unknown[]) => mockLink(...args),
}))

const user: User = {
  id: 348844,
  firstName: 'Josh',
  lastName: 'Santeramo',
  email: 'josh@example.com',
  hasPassword: false,
  createdAt: new Date('2026-10-13'),
  avatar: null,
  zip: null,
  phone: null,
}

const unlinked = {
  userId: user.id,
  personId: null,
  fullName: null,
  profileUrl: null,
  hasProfile: false,
}

const linked = {
  userId: user.id,
  personId: PERSON_ID,
  fullName: 'Joshua Santeramo',
  profileUrl: PROFILE_URL,
  hasProfile: false,
}

const subject = {
  personId: PERSON_ID,
  fullName: 'Joshua Santeramo',
  state: 'NV',
  office: 'District Court Judge',
}

const renderCard = () =>
  render(
    <UserProvider user={user}>
      <PublicProfileCard />
    </UserProvider>
  )

const allowWrites = (allowed: boolean) =>
  mockUseAuth.mockReturnValue({
    isSignedIn: true,
    orgId: 'org_dev',
    has: () => allowed,
  })

beforeEach(() => {
  vi.clearAllMocks()
  allowWrites(true)
})

describe('PublicProfileCard', () => {
  it('shows who a linked user is linked to, with no link action', async () => {
    mockGetLink.mockResolvedValue({ data: linked, error: null })

    renderCard()

    const person = await screen.findByRole('link', {
      name: 'Joshua Santeramo',
    })
    expect(person).toHaveAttribute('href', PROFILE_URL)
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(screen.getByText(PERSON_ID)).toBeInTheDocument()
    expect(screen.getByText('Not created yet')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link to public profile' })
    ).not.toBeInTheDocument()
  })

  it('offers the link action for an unlinked user', async () => {
    mockGetLink.mockResolvedValue({ data: unlinked, error: null })

    renderCard()

    expect(await screen.findByText('Not linked')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Link to public profile' })
    ).toBeInTheDocument()
  })

  it('hides the link action from staff who cannot write users', async () => {
    allowWrites(false)
    mockGetLink.mockResolvedValue({ data: unlinked, error: null })

    renderCard()

    expect(await screen.findByText('Not linked')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link to public profile' })
    ).not.toBeInTheDocument()
  })

  it('confirms the user and the person before linking', async () => {
    mockGetLink.mockResolvedValue({ data: unlinked, error: null })
    mockFind.mockResolvedValue({ data: subject, error: null })
    mockLink.mockResolvedValue({ data: linked, error: null })
    const ue = userEvent.setup()

    renderCard()
    await ue.click(
      await screen.findByRole('button', { name: 'Link to public profile' })
    )
    await ue.type(screen.getByLabelText('Profile link'), PROFILE_URL)
    await ue.click(screen.getByRole('button', { name: 'Find profile' }))

    // Nothing is written until staff have seen both names.
    expect(await screen.findByText('Josh Santeramo')).toBeInTheDocument()
    expect(screen.getByText(/user 348844/)).toBeInTheDocument()
    expect(screen.getByText('District Court Judge · NV')).toBeInTheDocument()
    expect(mockLink).not.toHaveBeenCalled()

    await ue.click(screen.getByRole('button', { name: 'Link profile' }))

    expect(mockFind).toHaveBeenCalledWith(PROFILE_URL)
    expect(mockLink).toHaveBeenCalledWith(user.id, PERSON_ID)
    expect(mockShowToast).toHaveBeenCalledWith('Profile linked')
    await waitFor(() => expect(screen.getByText('Linked')).toBeInTheDocument())
  })

  it("shows gp-api's reason when the link is refused", async () => {
    mockGetLink.mockResolvedValue({ data: unlinked, error: null })
    mockFind.mockResolvedValue({ data: subject, error: null })
    mockLink.mockResolvedValue({
      data: null,
      error: 'That person is already linked to user 346374',
    })
    const ue = userEvent.setup()

    renderCard()
    await ue.click(
      await screen.findByRole('button', { name: 'Link to public profile' })
    )
    await ue.type(screen.getByLabelText('Profile link'), PROFILE_URL)
    await ue.click(screen.getByRole('button', { name: 'Find profile' }))
    await ue.click(await screen.findByRole('button', { name: 'Link profile' }))

    expect(
      await screen.findByText('That person is already linked to user 346374')
    ).toBeInTheDocument()
    expect(mockShowToast).not.toHaveBeenCalled()
  })

  it('says so when the link matches no profile', async () => {
    mockGetLink.mockResolvedValue({ data: unlinked, error: null })
    mockFind.mockResolvedValue({
      data: null,
      error: 'No profile matches that link. Check it and try again.',
    })
    const ue = userEvent.setup()

    renderCard()
    await ue.click(
      await screen.findByRole('button', { name: 'Link to public profile' })
    )
    await ue.type(screen.getByLabelText('Profile link'), 'nobody-00000000')
    await ue.click(screen.getByRole('button', { name: 'Find profile' }))

    expect(
      await screen.findByText(
        'No profile matches that link. Check it and try again.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link profile' })
    ).not.toBeInTheDocument()
  })
})
