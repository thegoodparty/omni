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
vi.mock('../../../shared/serveAccess', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../shared/DashboardLayout', () => ({ default: () => null }))
vi.mock('./components/PriorityResultsView', () => ({
  PriorityResultsView: () => null,
}))

const params = Promise.resolve({ priorityId: 'pri-1' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.serverRequest.mockResolvedValue({ data: { id: 'pri-1', title: 'T' } })
})

describe('priority results page', () => {
  it('404s without asking gp-api when serve-citizen-panels is off', async () => {
    mocks.getFlagVariants.mockResolvedValue({
      'serve-citizen-panels': { value: 'off' },
    })

    await expect(Page({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.serverRequest).not.toHaveBeenCalled()
  })

  it('404s when the flags could not be read', async () => {
    mocks.getFlagVariants.mockResolvedValue(null)

    await expect(Page({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders with serve-citizen-panels on', async () => {
    mocks.getFlagVariants.mockResolvedValue({
      'serve-citizen-panels': { value: 'on' },
    })

    await expect(Page({ params })).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
