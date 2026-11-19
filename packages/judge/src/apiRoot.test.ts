import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { forgetResolvedApiRoots, resolveApiRoot } from './apiRoot'

// An arm is one of two shapes, and which one is a property of the URL rather
// than of a suite: a gp-api origin answers `/v1` at its own root, and a webapp
// root proxies gp-api at `/api`. Each fake below is one shape.

const serve = async (
  handler: (url: string) => number,
): Promise<{ server: Server; baseUrl: string }> => {
  const server = createServer((request, response) => {
    response.writeHead(handler(request.url ?? '')).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()))

afterEach(() => {
  forgetResolvedApiRoots()
})

describe('resolveApiRoot', () => {
  it('keeps a gp-api origin, which answers /v1 at its own root', async () => {
    const arm = await serve((url) => (url === '/v1/version' ? 200 : 404))
    expect(await resolveApiRoot(arm.baseUrl)).toBe(arm.baseUrl)
    await close(arm.server)
  })

  it('appends /api to a webapp root, which proxies gp-api there', async () => {
    const arm = await serve((url) => (url === '/api/v1/version' ? 200 : 404))
    expect(await resolveApiRoot(arm.baseUrl)).toBe(`${arm.baseUrl}/api`)
    await close(arm.server)
  })

  it('appends /api when neither answers, so a dead arm still fails loudly', async () => {
    const arm = await serve(() => 404)
    expect(await resolveApiRoot(arm.baseUrl)).toBe(`${arm.baseUrl}/api`)
    await close(arm.server)
  })

  it('resolves one URL once, however many runs ask', async () => {
    let probes = 0
    const arm = await serve((url) => {
      if (url === '/v1/version') probes += 1
      return url === '/api/v1/version' ? 200 : 404
    })
    await resolveApiRoot(arm.baseUrl)
    await resolveApiRoot(`${arm.baseUrl}/`)
    expect(probes).toBe(1)
    await close(arm.server)
  })
})
