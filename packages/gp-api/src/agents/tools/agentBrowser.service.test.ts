import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { ModuleRef } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { AgentBrowserService } from './agentBrowser.service'
import { browserTools } from './browserTools'
import type { ToolContext } from './tool'
import { AGENT_URL_GUARD } from './webHttp'

// Drives a real Chromium over CDP, the same path AgentCore Browser takes,
// so it runs only where a Playwright Chromium is installed (CI has none).
const chromePath = chromium.executablePath()

const PDF_BYTES = Buffer.from('%PDF-1.4\n% agenda packet\n%%EOF\n')

const pages: Record<string, string> = {
  '/meeting': `<html><body><div id="app">Loading...</div><script>
    setTimeout(() => {
      document.getElementById('app').innerHTML =
        '<h1>Agenda for November 10</h1><a href="/packet">Packet</a>'
    }, 300)
  </script></body></html>`,
  '/embedded': `<html><body><h1>Meeting packet viewer</h1><iframe src="/inline.pdf"></iframe></body></html>`,
  '/button': `<html><body><button onclick="document.body.insertAdjacentHTML('beforeend', '<p>Docs list opened</p>')">Show documents</button></body></html>`,
}

describe.skipIf(!existsSync(chromePath))('AgentBrowserService over CDP', () => {
  let chrome: ChildProcess
  let server: Server
  let origin: string
  let service: AgentBrowserService
  let ctx: ToolContext

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/packet') {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="packet.pdf"',
        })
        res.end(PDF_BYTES)
        return
      }
      if (req.url === '/inline.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end(PDF_BYTES)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pages[req.url ?? ''] ?? '<html><body>missing</body></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    chrome = spawn(chromePath, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/agent-browser-test-${process.pid}`,
      '--no-first-run',
      'about:blank',
    ])
    process.env.AGENT_BROWSER_CDP_URL = await new Promise<string>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no CDP url')), 15_000)
        chrome.stderr?.on('data', (chunk: Buffer) => {
          const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk))
          if (match?.[1]) {
            clearTimeout(timer)
            resolve(match[1])
          }
        })
      },
    )

    const module = await Test.createTestingModule({
      providers: [
        AgentBrowserService,
        { provide: PinoLogger, useValue: createMockLogger() },
        // The test pages are on loopback, which the real guard refuses.
        { provide: AGENT_URL_GUARD, useValue: async () => true },
      ],
    }).compile()
    service = module.get(AgentBrowserService)
    ctx = {
      runId: 'run-browser',
      stepKey: 'findAgenda:1',
      organizationSlug: 'org',
      signal: new AbortController().signal,
      moduleRef: module.get(ModuleRef),
    }
  }, 30_000)

  afterAll(async () => {
    await service?.onModuleDestroy()
    delete process.env.AGENT_BROWSER_CDP_URL
    chrome?.kill()
    await new Promise((resolve) => server?.close(resolve))
  })

  it('returns the page after its scripts run', async () => {
    const result = await service.render(
      'run-browser',
      `${origin}/meeting`,
      ctx.signal,
    )
    expect(result).toMatchObject({ kind: 'page', status: 200 })
    expect(result.kind === 'page' && result.html).toContain(
      'Agenda for November 10',
    )
  }, 30_000)

  it('captures a download-triggering response as bytes', async () => {
    const result = await service.render(
      'run-browser',
      `${origin}/packet`,
      ctx.signal,
    )
    expect(result).toEqual({
      kind: 'download',
      finalUrl: `${origin}/packet`,
      contentType: 'application/octet-stream',
      body: PDF_BYTES,
    })
  }, 60_000)

  it('captures a PDF the browser would otherwise display', async () => {
    const result = await service.render(
      'run-browser',
      `${origin}/inline.pdf`,
      ctx.signal,
    )
    expect(result).toMatchObject({
      kind: 'download',
      contentType: 'application/pdf',
      body: PDF_BYTES,
    })
  }, 60_000)

  it('keeps a page that embeds a PDF as a page', async () => {
    const result = await service.render(
      'run-browser',
      `${origin}/embedded`,
      ctx.signal,
    )
    expect(result).toMatchObject({ kind: 'page', status: 200 })
  }, 30_000)

  it('drives a page through the Playwright MCP tools', async () => {
    const tool = (name: string) => {
      const found = browserTools.find((t) => t.name === name)
      if (!found) throw new Error(`no ${name}`)
      return found
    }
    await tool('browser_navigate').execute({ url: `${origin}/button` }, ctx)
    const snapshot = z
      .object({ ok: z.boolean(), text: z.string() })
      .parse(await tool('browser_snapshot').execute({}, ctx))
    const ref = /button "Show documents" \[ref=(\w+)\]/.exec(snapshot.text)?.[1]
    expect(ref, snapshot.text).toBeDefined()

    const clicked = await tool('browser_click').execute(
      { element: 'Show documents button', target: ref },
      ctx,
    )
    const after = await tool('browser_snapshot').execute({}, ctx)

    expect(clicked, JSON.stringify(clicked)).toMatchObject({ ok: true })
    expect(JSON.stringify(after)).toContain('Docs list opened')
  }, 60_000)

  it('closes the run browser at the end of the run', async () => {
    await service.endRun('run-browser')
    const reopened = await service.render(
      'run-browser',
      `${origin}/meeting`,
      ctx.signal,
    )
    expect(reopened.kind).toBe('page')
    await service.endRun('run-browser')
  }, 30_000)
})
