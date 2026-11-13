/**
 * Runs the agent web tools against the live web, outside any agent: one run,
 * one browser session, a JavaScript-rendered CivicWeb meeting page, its
 * agenda packet, and the Playwright MCP browser tools.
 *
 * With AGENT_BROWSER_CDP_URL unset the browser is an AgentCore Browser
 * session, which needs AWS credentials allowed bedrock-agentcore browser
 * actions (`aws sso login --profile gp-engineer`, then AWS_PROFILE). Set it to
 * a local Chromium's CDP endpoint to run without AWS.
 *
 * Usage (not tsx: esbuild drops emitDecoratorMetadata, which Nest needs):
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/agent-web-tools-live.ts [meetingPageUrl]
 */
import { randomUUID } from 'crypto'
import { Module } from '@nestjs/common'
import { ModuleRef, NestFactory } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { AgentBrowserService } from '../src/agents/tools/agentBrowser.service'
import { AgentToolsModule } from '../src/agents/tools/agentTools.module'
import { AgentWebService } from '../src/agents/tools/agentWeb.service'
import { browserTools } from '../src/agents/tools/browserTools'
import { checkLink } from '../src/agents/tools/checkLink'
import { fetchPage } from '../src/agents/tools/fetchPage'
import { readDocument } from '../src/agents/tools/readDocument'
import { searchDocument } from '../src/agents/tools/searchDocument'
import type { AgentTool, ToolContext } from '../src/agents/tools/tool'

const MEETING_PAGE =
  process.argv[2] ??
  'https://monroewa.civicweb.net/Portal/MeetingInformation.aspx?Id=8147'

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { level: 'info' } }),
    AgentToolsModule,
  ],
})
class LiveModule {}

const main = async () => {
  const app = await NestFactory.createApplicationContext(LiveModule, {
    logger: false,
  })
  const ctx: ToolContext = {
    runId: `live-${randomUUID()}`,
    stepKey: 'live:1',
    organizationSlug: 'live',
    signal: new AbortController().signal,
    moduleRef: app.get(ModuleRef),
  }
  const backend = process.env.AGENT_BROWSER_CDP_URL
    ? `CDP ${process.env.AGENT_BROWSER_CDP_URL}`
    : 'AgentCore Browser'
  console.log(`run ${ctx.runId}, browser: ${backend}`)

  const call = async (tool: AgentTool, input: Record<string, unknown>) => {
    const started = Date.now()
    const result = await tool.execute(input, ctx)
    console.log(
      `\n## ${tool.name} ${JSON.stringify(input)} (${Date.now() - started} ms)`,
    )
    return result
  }

  try {
    const page = await call(fetchPage, { url: MEETING_PAGE })
    console.log(
      JSON.stringify(page, (key, value: unknown) =>
        key === 'content' ? undefined : value,
      ),
    )
    // The meeting's own links sit below the portal's navigation, past the
    // first slice, so read the whole page the way a model would: by offset.
    let content = ''
    for (let offset = 0; offset < 200_000; ) {
      const slice = await fetchPage.execute({ url: MEETING_PAGE, offset }, ctx)
      const text =
        typeof slice === 'object' && slice !== null && 'content' in slice
          ? String(slice.content)
          : ''
      if (!text) break
      content += text
      offset += text.length
    }
    const packet =
      /\[Agenda Packet\]\((https:[^)\s]+)\)/.exec(content)?.[1] ??
      /https:\/\/[^)\s]+\/document\/\d+[^)\s]*/.exec(content)?.[0]
    console.log(`agenda packet link in rendered page: ${packet ?? 'none'}`)

    if (packet) {
      console.log(JSON.stringify(await call(checkLink, { url: packet })))
      const read = await call(readDocument, { url: packet, pages: '1-2' })
      console.log(JSON.stringify(read).slice(0, 1200))
      const found = await call(searchDocument, {
        url: packet,
        query: 'public hearing|ordinance',
      })
      console.log(JSON.stringify(found).slice(0, 1200))

      const started = Date.now()
      const captured = await app
        .get(AgentBrowserService)
        .render(ctx.runId, packet, ctx.signal)
        .catch((err: unknown) => ({ kind: `failed: ${String(err)}` }) as const)
      console.log(
        `\n## browser render of the packet (${Date.now() - started} ms): ${captured.kind}` +
          (captured.kind === 'download'
            ? `, ${captured.contentType}, ${captured.body.length} bytes`
            : ''),
      )
    }

    const tool = (name: string) => {
      const found = browserTools.find((t) => t.name === name)
      if (!found) throw new Error(`no ${name}`)
      return found
    }
    await call(tool('browser_navigate'), { url: MEETING_PAGE })
    const snapshot = await call(tool('browser_snapshot'), {})
    console.log(JSON.stringify(snapshot).slice(0, 1500))
  } finally {
    await app.get(AgentWebService).endRun(ctx.runId)
    await app.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
