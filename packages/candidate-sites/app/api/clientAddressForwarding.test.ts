import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHelper } from '@/helpers/fetchHelper'
import { POST as contactForm } from './contact-form/[vanityPath]/route'
import { POST as trackView } from './websites/[vanityPath]/track-view/route'

vi.mock('@/helpers/fetchHelper', () => ({
  fetchHelper: vi.fn().mockResolvedValue(null),
}))

const mockedFetchHelper = vi.mocked(fetchHelper)

const postWithHeaders = (headers: Record<string, string>) =>
  new NextRequest('http://localhost:4001/api/whatever', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ visitorId: 'a', name: 'b' }),
  })

const params = Promise.resolve({ vanityPath: 'jordan-for-council' })

/** The headers the handler asked fetchHelper to send upstream. */
const forwardedHeaders = (): Record<string, string> | undefined => {
  const call = mockedFetchHelper.mock.calls[0]
  const options = call?.[1] as { headers?: Record<string, string> } | undefined
  return options?.headers
}

describe.each([
  { name: 'contact-form', handler: contactForm },
  { name: 'track-view', handler: trackView },
])('$name proxy', ({ handler }) => {
  beforeEach(() => {
    mockedFetchHelper.mockClear()
    mockedFetchHelper.mockResolvedValue(null)
  })

  it('forwards the visitor address from x-forwarded-for', async () => {
    await handler(postWithHeaders({ 'x-forwarded-for': '203.0.113.7' }), {
      params,
    })

    expect(forwardedHeaders()).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('forwards only the first entry of a proxy chain', async () => {
    await handler(
      postWithHeaders({
        'x-forwarded-for': '203.0.113.7, 198.51.100.1, 10.0.0.9',
      }),
      { params },
    )

    expect(forwardedHeaders()).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('falls back to x-real-ip', async () => {
    await handler(postWithHeaders({ 'x-real-ip': '198.51.100.4' }), { params })

    expect(forwardedHeaders()).toEqual({ 'X-Forwarded-For': '198.51.100.4' })
  })

  it('prefers x-forwarded-for over x-real-ip', async () => {
    await handler(
      postWithHeaders({
        'x-forwarded-for': '203.0.113.7',
        'x-real-ip': '198.51.100.4',
      }),
      { params },
    )

    expect(forwardedHeaders()).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('sends no address header when the request carries none', async () => {
    await handler(postWithHeaders({}), { params })

    expect(forwardedHeaders()).toEqual({})
  })

  it('sends no address header when x-forwarded-for is blank', async () => {
    await handler(postWithHeaders({ 'x-forwarded-for': '   ' }), { params })

    expect(forwardedHeaders()).toEqual({})
  })
})
