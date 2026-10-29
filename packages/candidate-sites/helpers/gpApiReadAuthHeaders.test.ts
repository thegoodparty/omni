import { getVercelOidcToken } from '@vercel/oidc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gpApiReadAuthHeaders } from './gpApiReadAuthHeaders'

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: vi.fn(),
}))

const mockedGetVercelOidcToken = vi.mocked(getVercelOidcToken)

describe('gpApiReadAuthHeaders', () => {
  beforeEach(() => {
    mockedGetVercelOidcToken.mockReset()
    mockedGetVercelOidcToken.mockResolvedValue('oidc-token')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('sends no header and skips OIDC when GP_API_AUTH_MODE is unset', async () => {
    vi.stubEnv('GP_API_AUTH_MODE', undefined)

    expect(await gpApiReadAuthHeaders()).toEqual({})
    expect(mockedGetVercelOidcToken).not.toHaveBeenCalled()
  })

  it('sends no header and skips OIDC for any other GP_API_AUTH_MODE', async () => {
    vi.stubEnv('GP_API_AUTH_MODE', 'on')

    expect(await gpApiReadAuthHeaders()).toEqual({})
    expect(mockedGetVercelOidcToken).not.toHaveBeenCalled()
  })

  describe('when GP_API_AUTH_MODE is oidc', () => {
    beforeEach(() => {
      vi.stubEnv('GP_API_AUTH_MODE', 'oidc')
    })

    it('sends the Vercel OIDC token', async () => {
      expect(await gpApiReadAuthHeaders()).toEqual({
        Authorization: 'Bearer oidc-token',
      })
    })

    it('fetches the token on every call', async () => {
      mockedGetVercelOidcToken
        .mockResolvedValueOnce('first-token')
        .mockResolvedValueOnce('second-token')

      expect(await gpApiReadAuthHeaders()).toEqual({
        Authorization: 'Bearer first-token',
      })
      expect(await gpApiReadAuthHeaders()).toEqual({
        Authorization: 'Bearer second-token',
      })
    })

    it('sends no header when getting the token throws', async () => {
      mockedGetVercelOidcToken.mockRejectedValue(new Error('no token'))

      expect(await gpApiReadAuthHeaders()).toEqual({})
      expect(console.warn).toHaveBeenCalled()
    })

    it('sends no header when the token is empty', async () => {
      mockedGetVercelOidcToken.mockResolvedValue('')

      expect(await gpApiReadAuthHeaders()).toEqual({})
    })
  })
})
