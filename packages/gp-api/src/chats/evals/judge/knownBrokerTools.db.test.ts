import { describe, expect, it } from 'vitest'
import { McpServerService } from '@/mcp/services/mcpServer.service'
import { useTestService } from '@/test-service'
import { BROKER_TOOL_PREFIX, KNOWN_BROKER_TOOLS } from './toolErrorDetails'

// The report prints a broker tool's name only if it is on KNOWN_BROKER_TOOLS,
// because a background model can invent a well-shaped name with a voter in
// it. That list is only safe while it matches the real tools, so it is
// checked against the names gp-api itself serves, derived the same way.
describe('KNOWN_BROKER_TOOLS', () => {
  const service = useTestService()

  it('lists exactly the @McpTool routes gp-api serves', () => {
    const served = service.app
      .get(McpServerService)
      .getTools()
      .map((tool) => `${BROKER_TOOL_PREFIX}${tool.toolName}`)
      .sort()
    expect(
      served,
      'An @McpTool route was added, renamed or removed. Update ' +
        'KNOWN_BROKER_TOOLS in chats/evals/judge/toolErrorDetails.ts to ' +
        'match, or the judge report prints that tool as "unknown".',
    ).toEqual([...KNOWN_BROKER_TOOLS].sort())
  })
})
