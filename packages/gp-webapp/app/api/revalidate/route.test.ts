import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath }))

import { POST } from './route'

const SECRET = 'top-secret-value'

function makeRequest({
  secret,
  path,
}: {
  secret?: string
  path?: string
}): NextRequest {
  const url = new URL('https://app.test/api/revalidate')
  if (path !== undefined) url.searchParams.set('path', path)
  const headers = new Headers()
  if (secret !== undefined) headers.set('authorization', `Bearer ${secret}`)
  return new NextRequest(url, { method: 'POST', headers })
}

describe('POST /api/revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REVALIDATE_SECRET', SECRET)
  })

  it('rejects a request with no secret', async () => {
    const res = await POST(makeRequest({ path: '/foo' }))
    expect(res.status).toBe(401)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong secret', async () => {
    const res = await POST(makeRequest({ secret: 'wrong', path: '/foo' }))
    expect(res.status).toBe(401)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fails closed when REVALIDATE_SECRET is not configured', async () => {
    vi.stubEnv('REVALIDATE_SECRET', '')
    const res = await POST(makeRequest({ secret: SECRET, path: '/foo' }))
    expect(res.status).toBe(401)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalidates the given path with the correct secret', async () => {
    const res = await POST(
      makeRequest({ secret: SECRET, path: '/candidate/x' }),
    )
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith('/candidate/x', 'page')
  })

  it('rejects a non-same-origin path (full URL or protocol-relative)', async () => {
    for (const bad of ['https://evil.example.com', '//evil.example.com']) {
      vi.clearAllMocks()
      const res = await POST(makeRequest({ secret: SECRET, path: bad }))
      expect(res.status).toBe(400)
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  })
})
