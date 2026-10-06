import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  candidateAccess: vi.fn(),
  getFlagVariants: vi.fn(),
  slug: { current: undefined as string | undefined },
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  default: () => mocks.candidateAccess(),
}))
vi.mock('@shared/experiments/getFlagVariants', () => ({
  getFlagVariants: () => mocks.getFlagVariants(),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () =>
      mocks.slug.current === undefined
        ? undefined
        : { value: mocks.slug.current },
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

import { issueCaptureAccess, issueCaptureFlagGate } from './issueCaptureAccess'

const on = { value: 'on' }

beforeEach(() => {
  mocks.candidateAccess.mockReset()
  mocks.getFlagVariants.mockReset()
  mocks.redirect.mockClear()
  mocks.slug.current = 'jane-for-council'
})

describe('issueCaptureAccess', () => {
  it('lets a campaign org in on the flag and speaks Win', async () => {
    mocks.getFlagVariants.mockResolvedValue({ 'issue-capture': on })

    await expect(issueCaptureAccess()).resolves.toEqual({ isServe: false })
    expect(mocks.candidateAccess).toHaveBeenCalled()
  })

  it('lets an elected office in on the flag and speaks Serve', async () => {
    mocks.slug.current = 'eo-springfield-council'
    mocks.getFlagVariants.mockResolvedValue({ 'issue-capture': on })

    await expect(issueCaptureAccess()).resolves.toEqual({ isServe: true })
  })

  it('sends a flag-off visit to the dashboard', async () => {
    mocks.getFlagVariants.mockResolvedValue({})

    await expect(issueCaptureAccess()).rejects.toThrow('redirect:/dashboard')
  })

  it('sends an elected office to the dashboard with the flag off', async () => {
    mocks.slug.current = 'eo-springfield-council'
    mocks.getFlagVariants.mockResolvedValue({ 'some-other-flag': on })

    await expect(issueCaptureAccess()).rejects.toThrow('redirect:/dashboard')
  })

  it('treats an unresolvable flag read as off', async () => {
    mocks.getFlagVariants.mockResolvedValue(null)

    await expect(issueCaptureAccess()).rejects.toThrow('redirect:/dashboard')
  })
})

// The volunteer's review page: the flag alone, since its layout is the role
// gate, and a flag-off visit goes back to where it came from.
describe('issueCaptureFlagGate', () => {
  it('checks the flag without the candidate gate', async () => {
    mocks.getFlagVariants.mockResolvedValue({ 'issue-capture': on })

    await expect(
      issueCaptureFlagGate('/volunteer/door-knocking/7'),
    ).resolves.toEqual({ isServe: false })
    expect(mocks.candidateAccess).not.toHaveBeenCalled()
  })

  it('sends a flag-off visit to the path it is given', async () => {
    mocks.getFlagVariants.mockResolvedValue({})

    await expect(
      issueCaptureFlagGate('/volunteer/door-knocking/7'),
    ).rejects.toThrow('redirect:/volunteer/door-knocking/7')
  })
})
