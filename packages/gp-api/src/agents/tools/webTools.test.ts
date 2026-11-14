import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { ModuleRef } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { mockClient } from 'aws-sdk-client-mock'
import { PinoLogger } from 'nestjs-pino'
import PDFDocument from 'pdfkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  AgentBrowserService,
  type BrowserRenderResult,
} from './agentBrowser.service'
import { AgentWebService } from './agentWeb.service'
import { checkLink } from './checkLink'
import { fetchPage } from './fetchPage'
import { AgentPageReplayService, replayUrlDigest } from './judgeReplay'
import { readDocument } from './readDocument'
import { searchDocument } from './searchDocument'
import type { ToolContext } from './tool'
import {
  AGENT_WEB_HTTP,
  type AgentWebHttp,
  type HttpFetchResult,
  type HttpHeadResult,
} from './webHttp'

const pdfWithPages = (pages: string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    for (const text of pages) {
      doc.addPage()
      doc.text(text)
    }
    doc.end()
  })

const html = (body: string) => `<html><body>${body}</body></html>`
const article = html(
  `<main><p>${'Budget hearing notes. '.repeat(60)}</p></main>`,
)
const civicWebShell = html(
  `<noscript>Your Javascript is turned off</noscript><nav>${'Menu link. '.repeat(80)}</nav><div>Loading...</div>`,
)

const okPage = (
  body: string | Buffer,
  contentType = 'text/html',
): Extract<HttpFetchResult, { kind: 'ok' }> => ({
  kind: 'ok',
  status: 200,
  contentType,
  body: Buffer.isBuffer(body) ? body : Buffer.from(body),
  finalUrl: 'https://city.gov/final',
})

const KEY = '_judge/replay/sweep/s1/meeting_briefing/case-1-1'

describe('web tools', () => {
  const s3 = mockClient(S3Client)
  const get = vi.fn<AgentWebHttp['get']>()
  const head = vi.fn<AgentWebHttp['head']>()
  const render =
    vi.fn<
      (
        runId: string,
        url: string,
        signal: AbortSignal,
      ) => Promise<BrowserRenderResult>
    >()
  let ctx: ToolContext
  let replay: AgentPageReplayService
  let web: AgentWebService

  beforeEach(async () => {
    s3.reset()
    s3.on(PutObjectCommand).resolves({})
    s3.on(GetObjectCommand).rejects(
      Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
    )
    get.mockReset()
    head.mockReset()
    render.mockReset()
    const module = await Test.createTestingModule({
      providers: [
        AgentWebService,
        AgentPageReplayService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: AGENT_WEB_HTTP, useValue: { get, head } },
        {
          provide: AgentBrowserService,
          useValue: { render, endRun: vi.fn() },
        },
      ],
    }).compile()
    replay = module.get(AgentPageReplayService)
    web = module.get(AgentWebService)
    ctx = {
      runId: 'run-1',
      stepKey: 'findAgenda:1',
      organizationSlug: 'org',
      signal: new AbortController().signal,
      moduleRef: module.get(ModuleRef),
    }
  })

  describe('fetchPage', () => {
    it('reads a server-rendered page over plain HTTP', async () => {
      get.mockResolvedValue(okPage(article))

      const result = await fetchPage.execute({ url: 'https://city.gov/a' }, ctx)

      expect(result).toMatchObject({
        ok: true,
        kind: 'page',
        finalUrl: 'https://city.gov/final',
        rendered: false,
        truncated: false,
      })
      expect(render).not.toHaveBeenCalled()
    })

    it('renders a JavaScript-only page in the run browser', async () => {
      get.mockResolvedValue(okPage(civicWebShell))
      render.mockResolvedValue({
        kind: 'page',
        status: 200,
        finalUrl: 'https://city.gov/meeting',
        html: html(
          '<h1>Agenda</h1><a href="/document/9/packet.pdf">Packet</a>',
        ),
      })

      const result = await fetchPage.execute(
        { url: 'https://city.gov/meeting' },
        ctx,
      )

      expect(render).toHaveBeenCalledWith(
        'run-1',
        'https://city.gov/meeting',
        ctx.signal,
      )
      expect(result).toMatchObject({ ok: true, rendered: true })
      expect(JSON.stringify(result)).toContain(
        'https://city.gov/document/9/packet.pdf',
      )
    })

    it('renders when a site refuses plain clients, and keeps a download the browser caught', async () => {
      const pdf = await pdfWithPages(['Agenda page one', 'Page two'])
      get.mockResolvedValue({ ...okPage('Forbidden'), status: 403 })
      render.mockResolvedValue({
        kind: 'download',
        finalUrl: 'https://city.gov/packet.pdf',
        contentType: 'application/pdf',
        body: pdf,
      })

      const result = await fetchPage.execute(
        { url: 'https://city.gov/packet' },
        ctx,
      )

      expect(result).toMatchObject({
        ok: true,
        kind: 'document',
        documentType: 'pdf',
        totalPages: 2,
        firstPage: 'Agenda page one',
      })
    })

    it('falls back to the plain page when the browser is unavailable', async () => {
      get.mockResolvedValue(okPage(civicWebShell))
      render.mockRejectedValue(new Error('AccessDeniedException'))

      const result = await fetchPage.execute({ url: 'https://city.gov/m' }, ctx)

      expect(result).toMatchObject({ ok: true, rendered: false })
    })

    it('pages through long content with offset', async () => {
      get.mockResolvedValue(okPage('x'.repeat(30_000), 'text/plain'))

      const first = await fetchPage.execute({ url: 'https://city.gov/t' }, ctx)
      const second = await fetchPage.execute(
        { url: 'https://city.gov/t', offset: 24_000 },
        ctx,
      )

      expect(first).toMatchObject({ truncated: true, totalChars: 30_000 })
      expect(second).toMatchObject({ truncated: false, offset: 24_000 })
      expect(get).toHaveBeenCalledTimes(1)
    })

    it('refuses private hosts without fetching', async () => {
      const result = await fetchPage.execute(
        { url: 'http://169.254.169.254/latest/meta-data' },
        ctx,
      )
      expect(result).toEqual({ ok: false, reason: 'blocked_host' })
      expect(get).not.toHaveBeenCalled()
    })

    it('reports an HTTP error without rendering', async () => {
      get.mockResolvedValue({ ...okPage('nope'), status: 404 })
      expect(
        await fetchPage.execute({ url: 'https://city.gov/gone' }, ctx),
      ).toEqual({ ok: false, reason: 'http_error', status: 404 })
      expect(render).not.toHaveBeenCalled()
    })

    it('serves a judge recording instead of the live page', async () => {
      const url = 'https://city.gov/agenda'
      const digest = replayUrlDigest(url)
      const body = 'Rendered agenda text from the base run'
      const bodyOf = (text: string) =>
        ({
          transformToString: async () => text,
          transformToByteArray: async () => new Uint8Array(Buffer.from(text)),
        }) as unknown as GetObjectCommandOutput['Body']
      s3.on(GetObjectCommand, { Key: `${KEY}/fetch/${digest}.json` }).resolves({
        LastModified: new Date(1_000_000),
        Body: bodyOf(
          JSON.stringify({
            status: 200,
            content_type: 'text/html',
            final_url: url,
            byte_size: body.length,
          }),
        ),
      })
      s3.on(GetObjectCommand, { Key: `${KEY}/fetch/${digest}.body` }).resolves({
        Body: bodyOf(body),
      })
      replay.bind('run-1', { mode: 'replay', key: KEY }, 2_000)

      const result = await fetchPage.execute({ url }, ctx)

      expect(result).toMatchObject({ ok: true, content: body })
      expect(get).not.toHaveBeenCalled()
    })
  })

  describe('readDocument and searchDocument', () => {
    const url = 'https://city.gov/packet.pdf'

    beforeEach(async () => {
      get.mockResolvedValue(
        okPage(
          await pdfWithPages([
            'Call to order',
            'Consent agenda',
            'Public hearing on the rezoning of 12 Main St',
          ]),
          'application/pdf',
        ),
      )
    })

    it('reads a page range and points at the next page', async () => {
      const result = await readDocument.execute({ url, pages: '1-2' }, ctx)

      expect(result).toEqual({
        ok: true,
        url,
        finalUrl: 'https://city.gov/final',
        documentType: 'pdf',
        totalPages: 3,
        pages: [
          { page: 1, text: 'Call to order' },
          { page: 2, text: 'Consent agenda' },
        ],
        nextPage: 3,
      })
    })

    it('finds passages by page and fetches the document once per run', async () => {
      const result = await searchDocument.execute(
        { url, query: 'REZONING|consent' },
        ctx,
      )
      await readDocument.execute({ url, pages: '3' }, ctx)

      expect(result).toMatchObject({
        ok: true,
        totalMatches: 2,
        matches: [
          { page: 2, match: 'Consent' },
          { page: 3, match: 'rezoning' },
        ],
      })
      expect(get).toHaveBeenCalledTimes(1)
    })

    it('refetches after the run ends', async () => {
      await readDocument.execute({ url }, ctx)
      await web.endRun('run-1')
      await readDocument.execute({ url }, ctx)
      expect(get).toHaveBeenCalledTimes(2)
    })

    it('says when a URL is a web page, not a document', async () => {
      get.mockResolvedValue(okPage(article))
      expect(
        await readDocument.execute({ url: 'https://city.gov/a' }, ctx),
      ).toMatchObject({ ok: false, reason: 'not_a_document' })
    })

    it('rejects a page past the end', async () => {
      expect(await readDocument.execute({ url, pages: '9' }, ctx)).toEqual({
        ok: false,
        reason: 'page_out_of_range',
        totalPages: 3,
      })
    })
  })

  describe('checkLink', () => {
    it('reports status and final URL from a HEAD request', async () => {
      head.mockResolvedValue({
        kind: 'ok',
        status: 301,
        finalUrl: 'https://city.gov/new',
      } satisfies HttpHeadResult)

      expect(
        await checkLink.execute({ url: 'https://city.gov/old' }, ctx),
      ).toEqual({
        ok: true,
        url: 'https://city.gov/old',
        status: 301,
        finalUrl: 'https://city.gov/new',
        reachable: true,
      })
    })

    it('falls back to GET when a server refuses HEAD', async () => {
      head.mockResolvedValue({ kind: 'ok', status: 405, finalUrl: 'x' })
      get.mockResolvedValue(okPage(article))

      expect(
        await checkLink.execute({ url: 'https://city.gov/a' }, ctx),
      ).toMatchObject({ ok: true, status: 200, reachable: true })
    })
  })
})
