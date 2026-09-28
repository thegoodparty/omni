import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { EnvironmentGate } from './EnvironmentGate'

const DEV_ORG = 'org_dev_123'
const PROD_ORG = 'org_prod_456'

const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

const renderGate = async () => {
  const ui = await EnvironmentGate({ children: <div>Dashboard content</div> })
  return render(<Theme>{ui}</Theme>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('GP_ORG_ID_DEV', DEV_ORG)
  vi.stubEnv('GP_ORG_ID_PROD', PROD_ORG)
  vi.stubEnv('GP_ADMIN_ENVIRONMENTS', 'dev')
  mockAuth.mockResolvedValue({ orgId: DEV_ORG })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('EnvironmentGate', () => {
  it('renders the dashboard for an organization this deployment serves', async () => {
    await renderGate()

    expect(screen.getByText('Dashboard content')).toBeVisible()
  })

  it('blocks an organization this deployment does not serve', async () => {
    mockAuth.mockResolvedValue({ orgId: PROD_ORG })

    await renderGate()

    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
    expect(screen.getByText(/reaches the dev environment only/)).toBeVisible()
  })

  it('blocks an organization it has no mapping for', async () => {
    mockAuth.mockResolvedValue({ orgId: 'org_unknown' })

    await renderGate()

    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
  })

  it('leaves the no-organization case to OrganizationRequired', async () => {
    mockAuth.mockResolvedValue({ orgId: null })

    await renderGate()

    expect(screen.getByText('Dashboard content')).toBeVisible()
  })

  it('serves both organizations when no allow-list is set', async () => {
    vi.stubEnv('GP_ADMIN_ENVIRONMENTS', undefined)
    mockAuth.mockResolvedValue({ orgId: PROD_ORG })

    await renderGate()

    expect(screen.getByText('Dashboard content')).toBeVisible()
  })
})
