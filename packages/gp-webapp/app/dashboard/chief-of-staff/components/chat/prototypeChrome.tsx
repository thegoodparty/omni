import type { ReactNode } from 'react'
import { cn, GoodPartyOrgLogo } from '@styleguide'
import {
  ASSISTANT_BUBBLE,
  ChatMarkdown,
  ToolPillRow,
} from '../../../shared/agent-chat/chatUI'
import type { LiveSegment } from '../../../shared/agent-chat/streaming'
import { chunkTurn, promoteChunkLabel } from './chunkTurn'
import type { ChatChrome } from './chatChrome'
import './prototypeChrome.css'

// The conversation-first Chief of Staff home's own turn chrome, measured off
// the design's computed styles: a 34px cream avatar, a 10px gap (which is what
// makes the 44px assistant indent 44px), an #f7fafb bubble with a hairline
// border and 16/16/16/4 corners, and a dot typing indicator.
//
// Serve only, on purpose. See chatChrome.tsx for why this is a separate chrome
// rather than an edit to shared/agent-chat/chatUI.tsx.

// 34px is the design's avatar, and ASSISTANT_INDENT (pl-11 = 44px) is derived
// from it plus the 10px row gap. Changing this without changing that leaves
// every card in the rail hanging off the wrong edge.
const AVATAR = 'size-[34px]'

const ProtoAvatar = (): React.JSX.Element => (
  <span
    className={cn(
      AVATAR,
      'flex shrink-0 items-center justify-center rounded-full',
      'border border-border/70 bg-brand-cream',
    )}
  >
    <GoodPartyOrgLogo className="h-4 w-[18px]" />
  </span>
)

// Reuses the shared bubble's markdown plumbing (the !block / !inline overrides
// are load-bearing and long) and overrides only the chrome. cn() is
// tailwind-merge, so the trailing radius and border win over the shared ones
// rather than depending on stylesheet order.
// Body type is the spec's 16px/1.5 (`text-base`), not the shared 14px, and the
// padding is opened up to match. The label that opens a chunk renders as an h3,
// so it gets the spec's semibold heading treatment on its own line.
export const PROTO_ASSISTANT_BUBBLE = cn(
  ASSISTANT_BUBBLE,
  'proto-bubble rounded-2xl rounded-bl-sm border border-border',
  'px-4 py-3 text-base',
  '[&_h3]:!text-base [&_h3]:!font-semibold [&_h3]:tracking-[-0.02em]',
)

// Exported because the onboarding steps and the next-step push render their own
// assistant turns in the trailing slot: they have to use the same avatar and
// gap as the transcript above them or the column visibly steps.
export const ProtoAssistantRow = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => (
  <div className="proto-turn-in flex max-w-full items-start gap-2.5 self-start">
    <ProtoAvatar />
    <div className="flex min-w-0 max-w-full flex-col gap-2">{children}</div>
  </div>
)

const ProtoAssistantMarkdown = ({
  children,
}: {
  children: string
}): React.JSX.Element => (
  <div className={PROTO_ASSISTANT_BUBBLE}>
    <ChatMarkdown>{children}</ChatMarkdown>
  </div>
)

// Mirrors the assistant bubble's asymmetry to the other corner, so the two
// sides of the conversation read as a matched pair.
const ProtoUserBubble = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => (
  <div className="proto-turn-in self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
    {children}
  </div>
)

// The label is still rendered, for screen readers only: the dots carry no
// meaning without it, and it is the only thing that says the agent is working
// rather than broken.
const ProtoThinkingRow = ({
  label = 'Thinking...',
}: {
  label?: string
}): React.JSX.Element => (
  <div className="proto-turn-in flex items-start gap-2.5 self-start">
    <ProtoAvatar />
    <div
      role="status"
      className={cn(
        'proto-bubble flex h-9 items-center gap-1.5 rounded-2xl rounded-bl-sm',
        'border border-border/70 bg-muted px-3.5',
      )}
    >
      <span className="sr-only">{label}</span>
      <span className="proto-dot size-1.5 rounded-full bg-muted-foreground" />
      <span className="proto-dot size-1.5 rounded-full bg-muted-foreground" />
      <span className="proto-dot size-1.5 rounded-full bg-muted-foreground" />
    </div>
  </div>
)

// Same stream-order walk as the shared InlineSegments — text as bubbles, tool
// calls as inline pills — with the prototype's bubble. The tool pills are
// unchanged; they already read as system chrome rather than as the agent.
const ProtoInlineSegments = ({
  segments,
  toolLabel,
}: {
  segments: LiveSegment[]
  toolLabel: (toolName: string) => string | null
}): React.JSX.Element => {
  const blocks: ReactNode[] = []
  let pendingPills: string[] = []
  let pendingRunning = false

  const flushPills = (key: string): void => {
    if (pendingPills.length > 0) {
      blocks.push(
        <ToolPillRow
          key={`pills-${key}`}
          labels={pendingPills}
          running={pendingRunning}
        />,
      )
      pendingPills = []
      pendingRunning = false
    }
  }

  segments.forEach((seg, i) => {
    if (seg.kind === 'tool') {
      const label = toolLabel(seg.toolName)
      if (label) {
        pendingPills.push(label)
        if (seg.running) pendingRunning = true
      }
      return
    }
    flushPills(String(i))
    if (seg.text) {
      // One bubble per section rather than one per segment: a long answer
      // arrives as the pieces it is made of. The reveal upstream slices by
      // character budget, so a growing turn crosses these boundaries one at a
      // time and the chunks land in sequence.
      chunkTurn(seg.text).forEach((chunk, c) => {
        blocks.push(
          <div key={`text-${i}-${c}`} className={PROTO_ASSISTANT_BUBBLE}>
            <ChatMarkdown>{promoteChunkLabel(chunk)}</ChatMarkdown>
          </div>,
        )
      })
    }
  })

  flushPills('end')
  return <>{blocks}</>
}

const ProtoQuickReply = ({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'rounded-full border border-border bg-card px-3.5 py-2',
      'text-[13px] font-medium text-card-foreground',
      'transition-colors duration-150 hover:border-primary hover:bg-primary/5',
      'focus-visible:border-primary',
      'disabled:pointer-events-none disabled:opacity-50',
    )}
  >
    {children}
  </button>
)

export const PROTOTYPE_CHAT_CHROME: ChatChrome = {
  AssistantRow: ProtoAssistantRow,
  AssistantMarkdown: ProtoAssistantMarkdown,
  UserBubble: ProtoUserBubble,
  ThinkingRow: ProtoThinkingRow,
  InlineSegments: ProtoInlineSegments,
  assistantBubble: PROTO_ASSISTANT_BUBBLE,
  QuickReply: ProtoQuickReply,
  // Indented to align under the bubble rather than under the avatar: the
  // column's own gutter (12/16/24px) plus the 44px the avatar and its gap
  // occupy. Each side is set explicitly so nothing depends on which of two
  // padding utilities the generated stylesheet happens to emit last.
  quickReplyRowClassName:
    'mx-auto flex w-full max-w-[608px] flex-wrap gap-2 pb-1 pt-2 pr-3 pl-14 sm:pr-4 sm:pl-15 md:pr-6 md:pl-17',
  // The conversation scrolls under the composer instead of stopping at a rule,
  // so the bar needs its own ground to stay legible over moving text.
  composerBarClassName:
    'border-t border-border/60 bg-background/80 px-3 py-3 backdrop-blur-md',
}
