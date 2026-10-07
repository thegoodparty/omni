import type { ReactNode } from 'react'

// The tool call a widget renders from. Every field is fixed for a given call,
// which is why a parse may close over it (a card can derive an id from
// `toolCallId`). The surface's own context goes to `render` instead, so an
// instance held in state across renders never pins a stale callback.
export interface WidgetToolCall {
  toolName: string
  // Null on a live turn whose conversation is still being created.
  conversationId: string | null
  toolCallId: string | null
  // Null on the live turn: there is no persisted row yet.
  messageId: string | null
  segmentIndex: number | null
}

export type WidgetToolCallInput = Pick<WidgetToolCall, 'toolName'> &
  Partial<Omit<WidgetToolCall, 'toolName'>>

export interface WidgetInstance<Ctx> {
  toolName: string
  render: (ctx: Ctx) => ReactNode
}

export interface WidgetToolEntry<Ctx> {
  toolName: string
  // What a reloaded turn does with a registered tool whose args did not parse:
  // 'hide' drops the segment, 'inline' leaves it in the prose run as an
  // ordinary tool pill (for a tool that is only sometimes a widget).
  onParseFailure: 'hide' | 'inline'
  resolve: (args: unknown, call: WidgetToolCall) => WidgetInstance<Ctx> | null
}

export const defineWidgetTool = <Data extends object, Ctx>({
  toolName,
  parse,
  render,
  onParseFailure = 'hide',
}: {
  toolName: string
  parse: (args: unknown, call: WidgetToolCall) => Data | null
  render: (data: Data, ctx: Ctx, call: WidgetToolCall) => ReactNode
  onParseFailure?: 'hide' | 'inline'
}): WidgetToolEntry<Ctx> => ({
  toolName,
  onParseFailure,
  resolve: (args, call) => {
    const data = parse(args, call)
    if (data === null) return null
    return { toolName, render: (ctx) => render(data, ctx, call) }
  },
})

export interface WidgetRegistry<Ctx> {
  has: (toolName: string) => boolean
  entry: (toolName: string) => WidgetToolEntry<Ctx> | undefined
  // Null for an unknown tool name as well as for args that fail to parse, so a
  // thread written by a newer build still opens.
  resolve: (
    call: WidgetToolCallInput,
    args: unknown,
  ) => WidgetInstance<Ctx> | null
}

export const createWidgetRegistry = <Ctx>(
  entries: WidgetToolEntry<Ctx>[],
): WidgetRegistry<Ctx> => {
  const byName = new Map(entries.map((e) => [e.toolName, e]))
  return {
    has: (toolName) => byName.has(toolName),
    entry: (toolName) => byName.get(toolName),
    resolve: (call, args) => {
      const entry = byName.get(call.toolName)
      if (!entry) return null
      return entry.resolve(args, {
        toolName: call.toolName,
        conversationId: call.conversationId ?? null,
        toolCallId: call.toolCallId ?? null,
        messageId: call.messageId ?? null,
        segmentIndex: call.segmentIndex ?? null,
      })
    },
  }
}
