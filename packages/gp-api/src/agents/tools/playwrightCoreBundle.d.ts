// Playwright MCP's tool set ships inside playwright-core; `@playwright/mcp`
// is a two-line wrapper that re-exports `tools.createConnection` from this
// bundle. playwright-core is pinned to an exact version because this subpath
// is not a documented API.
declare module 'playwright-core/lib/coreBundle' {
  import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
  import type { BrowserContext } from 'playwright-core'
  import type { JSONSchema } from 'zod/v4/core'

  type PlaywrightMcpTool = {
    schema: {
      name: string
      description: string
      inputSchema: { toJSONSchema: () => JSONSchema.JSONSchema }
    }
  }

  export const tools: {
    browserTools: PlaywrightMcpTool[]
    createConnection: (
      config: Record<string, unknown>,
      contextGetter: () => Promise<BrowserContext>,
    ) => Promise<{
      connect: (transport: Transport) => Promise<void>
      close: () => Promise<void>
    }>
  }
}
