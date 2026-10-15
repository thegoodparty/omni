import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'

const mocks = vi.hoisted(() => ({
  getFlagVariants: vi.fn(),
  serverRequest: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@shared/experiments/getFlagVariants', () => ({
  getFlagVariants: mocks.getFlagVariants,
}))
vi.mock('gpApi/server-request', () => ({
  serverRequest: mocks.serverRequest,
}))
vi.mock('../../shared/serveAccess', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../shared/DashboardLayout', () => ({ default: () => null }))
vi.mock('./components/CitizensPanelView', () => ({
  CitizensPanelView: () => null,
}))

const flagOn = () =>
  mocks.getFlagVariants.mockResolvedValue({
    'serve-citizen-panels': { value: 'on' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.serverRequest.mockResolvedValue({
    data: {
      members: 3,
      reachedRecently: 1,
      askableNow: 2,
      lastOutreachAt: null,
    },
  })
})

describe('civic panel page', () => {
  it('404s without asking gp-api when serve-citizen-panels is off', async () => {
    mocks.getFlagVariants.mockResolvedValue({
      'serve-citizen-panels': { value: 'off' },
    })

    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.serverRequest).not.toHaveBeenCalled()
  })

  it('404s when the flags could not be read', async () => {
    mocks.getFlagVariants.mockResolvedValue(null)

    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404s when the panel cannot be read, as for a Win org', async () => {
    flagOn()
    mocks.serverRequest.mockRejectedValue(new Error('400'))

    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders with serve-citizen-panels on', async () => {
    flagOn()

    await expect(Page()).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
