import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api } from 'helpers/test-utils/api-mocking'
import { clientRequest } from './typed-request'
import { resetSignInRequestForTests } from './unauthorized'

// A request the /api rewrite could not authenticate means the tab lost its
// session, so the page must not keep failing every query on it: `clientRequest`
// sends the user to sign in, with the current path to come back to, and then
// rethrows so callers still see the error (ENG-11674).
const stubLocation = (pathname: string, search = '') => {
  const assign = vi.fn()
  // `href` too: ofetch resolves the request URL against the window location,
  // so a bare stub breaks every request before it reaches the mock.
  const href = new URL(`${pathname}${search}`, 'http://localhost').href
  vi.stubGlobal('location', { pathname, search, href, assign })
  return assign
}

const noSessionResponse = () => ({
  status: 401 as const,
  // What the guards throw on a request with no session.
  data: { message: 'Unauthorized', statusCode: 401 },
})

describe('clientRequest on a 401', () => {
  beforeEach(() => {
    resetSignInRequestForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the user to sign in when the request went out with no session', async () => {
    const assign = stubLocation('/dashboard/campaign-plan', '?tab=plan')
    api.mock('GET /v1/onboarding/voter-issues', noSessionResponse())

    await expect(
      clientRequest('GET /v1/onboarding/voter-issues', {}),
    ).rejects.toThrow()

    expect(assign).toHaveBeenCalledWith(
      `/login?redirect_url=${encodeURIComponent(
        '/dashboard/campaign-plan?tab=plan',
      )}`,
    )
  })

  it('navigates once for a page whose queries all fail at the same time', async () => {
    const assign = stubLocation('/dashboard/campaign-plan')
    api.mock('GET /v1/onboarding/voter-issues', noSessionResponse())
    api.mock('GET /v1/onboarding/contacts/stats', noSessionResponse())

    await Promise.allSettled([
      clientRequest('GET /v1/onboarding/voter-issues', {}),
      clientRequest('GET /v1/onboarding/contacts/stats', {}),
    ])

    expect(assign).toHaveBeenCalledTimes(1)
  })

  // A few routes 401 for their own reasons with a live session and say why in
  // the message. Sending a signed-in user to /login for one of those would throw
  // away what they were doing.
  it('leaves a 401 that names its own reason to the caller', async () => {
    const assign = stubLocation('/dashboard/campaign-plan')
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 401,
      data: { message: 'Invalid password', statusCode: 401 },
    })

    await expect(
      clientRequest('GET /v1/onboarding/voter-issues', {}),
    ).rejects.toThrow()

    expect(assign).not.toHaveBeenCalled()
  })

  it('leaves other failures to the caller', async () => {
    const assign = stubLocation('/dashboard/campaign-plan')
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 500,
      data: { message: 'boom' },
    })

    await expect(
      clientRequest('GET /v1/onboarding/voter-issues', {}),
    ).rejects.toThrow()

    expect(assign).not.toHaveBeenCalled()
  })

  it('does not redirect from the sign-in page itself', async () => {
    const assign = stubLocation('/login', '?redirect_url=%2Fdashboard')
    api.mock('GET /v1/onboarding/voter-issues', noSessionResponse())

    await expect(
      clientRequest('GET /v1/onboarding/voter-issues', {}),
    ).rejects.toThrow()

    expect(assign).not.toHaveBeenCalled()
  })
})
