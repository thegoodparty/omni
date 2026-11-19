import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PinoLogger } from 'nestjs-pino'
import { AgentBrowserService } from './agentBrowser.service'
import { AgentWebService } from './agentWeb.service'
import { fetchPage } from './fetchPage'
import type { AgentPageReplayService } from './judgeReplay'
import { renderPage } from './renderPage'
import type { ToolContext } from './tool'

// Real AgentCore sessions under the gp-engineer profile, so local only:
// RENDER_PAGE_LIVE=1 npx vitest run src/agents/tools/renderPage.live.test.ts
// fayobserver.com answers the managed browser with the same 402 it gives
// plain HTTP, so it stays unreadable.
const PAGES: [string, boolean][] = [
  [
    'https://fayettevilleflyer.com/2026/10/19/incumbent-moore-faces-coleman-in-bid-to-represent-downtown-fayetteville/',
    true,
  ],
  [
    'https://www.fayobserver.com/story/news/local/2026/10/21/fayetteville-nc-moves-closer-to-data-center-moratorium/92286170007/',
    false,
  ],
]

type Outcome =
  | { ok: true; status: number; totalChars: number; published: string | null }
  | { ok: false; reason: string; status?: number }

describe.runIf(process.env.RENDER_PAGE_LIVE === '1')('renderPage live', () => {
  // The test env drops AWS_PROFILE and sets static keys that would shadow it.
  beforeAll(() => {
    process.env.AWS_PROFILE = 'gp-engineer'
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.AWS_SESSION_TOKEN
  })

  it.each(PAGES)(
    'renders %s, which fetchPage cannot read',
    async (url, recovers) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const logger = { warn: vi.fn(), info: vi.fn() } as unknown as PinoLogger
      const browser = new AgentBrowserService(logger)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const web = new AgentWebService({} as AgentPageReplayService)
      const ctx: ToolContext = {
        runId: `live-${Date.now()}`,
        stepKey: '0:renderPage:0',
        organizationSlug: 'org',
        signal: new AbortController().signal,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        get: ((token: unknown) =>
          token === AgentWebService
            ? web
            : browser) as unknown as ToolContext['get'],
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fetched = (await fetchPage.execute({ url }, ctx)) as Outcome
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rendered = (await renderPage.execute({ url }, ctx)) as Outcome
      console.log(
        JSON.stringify({
          url,
          fetchPage: fetched.ok ? 'ok' : fetched,
          renderPage: rendered.ok
            ? {
                ok: true,
                status: rendered.status,
                totalChars: rendered.totalChars,
                published: rendered.published,
              }
            : rendered,
        }),
      )
      expect(fetched.ok).toBe(false)
      expect(rendered.ok).toBe(recovers)
    },
    120_000,
  )
})
