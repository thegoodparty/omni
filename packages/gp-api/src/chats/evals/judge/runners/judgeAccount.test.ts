import { describe, expect, it } from 'vitest'
import { CreateElectedOfficeSchema } from '@/electedOffice/schemas/electedOffice.schema'
import { isTestUser } from '@/users/util/users.util'
import {
  judgeAccountEmail,
  judgeAccounts,
  type ClerkPort,
} from './judgeAccount'

const BASE = 'https://gp-api.test'

interface Call {
  method: string
  path: string
  body?: unknown
  slug?: string
}

// A deployment that accepts every setup call and answers each create with the
// row the next call needs.
const fakeApi = (status: (path: string) => number = () => 200) => {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = (input, init) => {
    const path = String(input).slice(BASE.length)
    const headers = new Headers(init?.headers)
    calls.push({
      method: init?.method ?? 'GET',
      path,
      ...(typeof init?.body === 'string' && {
        body: JSON.parse(init.body) as unknown,
      }),
      ...(headers.get('x-organization-slug') !== null && {
        slug: headers.get('x-organization-slug') ?? '',
      }),
    })
    const answer = (value: object): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(value), { status: status(path) }),
      )
    if (path === '/v1/elected-office') {
      return answer({ id: 'eo1', organizationSlug: 'eo-eo1' })
    }
    return answer({})
  }
  return { calls, fetchImpl }
}

const fakeClerk = (failDelete = false) => {
  const created: string[] = []
  const deleted: string[] = []
  const port: ClerkPort = {
    createUser: (email) => {
      created.push(email)
      return Promise.resolve(`user_${created.length}`)
    },
    mintToken: (id) => Promise.resolve(`token-${id}`),
    deleteUser: (id) => {
      if (failDelete) return Promise.reject(new Error('Clerk is down'))
      deleted.push(id)
      return Promise.resolve()
    },
  }
  return { port, created, deleted }
}

const http = (fetchImpl: typeof fetch) => ({
  baseUrl: BASE,
  fetchImpl,
  sleep: () => Promise.resolve(),
})

describe('judgeAccountEmail', () => {
  it("passes gp-api's test-user rule", () => {
    expect(isTestUser({ email: judgeAccountEmail() })).toBe(true)
  })
})

describe('judgeAccounts', () => {
  it('gives Chief of Staff an elected office and nothing else', async () => {
    const api = fakeApi()
    const clerk = fakeClerk()
    const account = await judgeAccounts(
      http(api.fetchImpl),
      clerk.port,
    ).provision('chief_of_staff')
    expect(account).toEqual({
      token: 'token-user_1',
      organizationSlug: 'eo-eo1',
    })
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /v1/users/me',
      'POST /v1/elected-office',
    ])
    expect(api.calls[1]?.body).toEqual({ customPositionName: 'Council Member' })
    expect(
      CreateElectedOfficeSchema.safeParse(api.calls[1]?.body).success,
    ).toBe(true)
  })

  it('waits out a cold deployment on the first call', async () => {
    let first = true
    const api = fakeApi((path) => {
      if (path === '/v1/users/me' && first) {
        first = false
        return 502
      }
      return 200
    })
    const account = await judgeAccounts(
      http(api.fetchImpl),
      fakeClerk().port,
    ).provision('chief_of_staff')
    expect(account.organizationSlug).toBe('eo-eo1')
    expect(
      api.calls.filter((call) => call.path === '/v1/users/me'),
    ).toHaveLength(2)
  })

  it('names the route that refused a setup call', async () => {
    const api = fakeApi((path) => (path === '/v1/elected-office' ? 403 : 200))
    await expect(
      judgeAccounts(http(api.fetchImpl), fakeClerk().port).provision(
        'chief_of_staff',
      ),
    ).rejects.toThrow(/POST \/v1\/elected-office returned 403/)
  })

  it('refuses a chat agent it sets no state up for, before making a user', async () => {
    const clerk = fakeClerk()
    await expect(
      judgeAccounts(http(fakeApi().fetchImpl), clerk.port).provision(
        'priority_flow',
      ),
    ).rejects.toThrow(/not a chat scope the runner can drive/)
    expect(clerk.created).toEqual([])
  })

  it('refuses an agent that is not a chat scope before making a user', async () => {
    const clerk = fakeClerk()
    await expect(
      judgeAccounts(http(fakeApi().fetchImpl), clerk.port).provision(
        'meeting_briefing',
      ),
    ).rejects.toThrow(/not a chat scope/)
    expect(clerk.created).toEqual([])
  })

  it('deletes every user it made, and reports the ones it could not', async () => {
    const api = fakeApi()
    const clerk = fakeClerk()
    const accounts = judgeAccounts(http(api.fetchImpl), clerk.port)
    await accounts.provision('chief_of_staff')
    await accounts.provision('chief_of_staff')
    expect(await accounts.deleteAll()).toEqual([])
    expect(clerk.deleted).toEqual(['user_1', 'user_2'])

    const failing = fakeClerk(true)
    const broken = judgeAccounts(http(api.fetchImpl), failing.port)
    await broken.provision('chief_of_staff')
    expect(await broken.deleteAll()).toEqual(['user_1: Clerk is down'])
  })
})
