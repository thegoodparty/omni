import { tools as playwrightTools } from 'playwright-core/lib/coreBundle'
import { z } from 'zod'
import { AgentBrowserService } from './agentBrowser.service'
import type { AgentTool } from './tool'

// The subset of Playwright MCP's tools a reading agent needs to get through
// a portal: open a page, read its accessibility snapshot, and act on the
// refs in that snapshot. Script evaluation, file access, network routing and
// storage tools are left out.
const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_select_option',
  'browser_press_key',
  'browser_wait_for',
] as const

// Opt-in per agent: a stage that lists these drives the run's remote
// browser (the same AgentCore session fetchPage renders in) through the
// off-the-shelf Playwright MCP server, served in-process. Schemas and
// descriptions are Playwright's own, converted to Zod.
export const browserTools: AgentTool[] = BROWSER_TOOL_NAMES.map((name) => {
  const tool = playwrightTools.browserTools.find((t) => t.schema.name === name)
  if (!tool) throw new Error(`Playwright MCP has no ${name} tool`)
  return {
    name,
    description: tool.schema.description,
    input: z.fromJSONSchema(tool.schema.inputSchema.toJSONSchema()),
    execute: async (input, ctx) => {
      const browser = ctx.moduleRef.get(AgentBrowserService, { strict: false })
      const args = z.record(z.string(), z.unknown()).parse(input ?? {})
      return browser.callBrowserTool(ctx.runId, name, args)
    },
  }
})
