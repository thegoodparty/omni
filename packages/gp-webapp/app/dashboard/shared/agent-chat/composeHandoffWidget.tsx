import { Button } from '@styleguide'
import { Share2Icon } from '@styleguide/components/ui/icons'
import {
  ComposeHandoffPayloadSchema,
  type ComposeHandoffPayload,
} from '@goodparty_org/contracts'
import { defineWidgetTool } from './widgetRegistry'

export const COMPOSE_HANDOFF_TOOL = 'compose_handoff'

const COMPOSE_HANDOFF_CHANNEL_LABEL: Record<
  ComposeHandoffPayload['channel'],
  string
> = {
  serve_social: 'Social Post',
  win_social: 'Social Post',
}

// A CTA card rendered when the agent returns a compose_handoff tool segment.
// Shows the target channel, a preview of the draft text, and a button to
// navigate into the matching compose flow. The flag gate is upstream in the
// tool registration; this component renders unconditionally once shown.
export const ComposeHandoffCard = ({
  payload,
  onClick,
}: {
  payload: ComposeHandoffPayload
  onClick: () => void
}): React.JSX.Element => {
  const channelLabel = COMPOSE_HANDOFF_CHANNEL_LABEL[payload.channel]
  const firstLine = payload.draftText.split('\n')[0] ?? ''
  const previewText = firstLine.slice(0, 80)
  const truncated =
    previewText.length < firstLine.length || payload.draftText.includes('\n')

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Share2Icon className="size-3.5" aria-hidden />
        {channelLabel}
      </div>
      <p className="text-sm text-foreground">
        {previewText}
        {truncated ? '…' : null}
      </p>
      <Button type="button" size="small" onClick={onClick}>
        Continue in compose
      </Button>
    </div>
  )
}

export type ComposeHandoffWidgetContext = {
  onComposeHandoff: (payload: ComposeHandoffPayload) => void
}

// A surface that does not register this must also hide the tool from its pill
// labels: the name is internal, and nothing else keeps it off the screen.
export const composeHandoffWidgetTool = defineWidgetTool({
  toolName: COMPOSE_HANDOFF_TOOL,
  parse: (args) => {
    const parsed = ComposeHandoffPayloadSchema.safeParse(args)
    return parsed.success ? parsed.data : null
  },
  render: (payload, { onComposeHandoff }: ComposeHandoffWidgetContext) => (
    <ComposeHandoffCard
      payload={payload}
      onClick={() => onComposeHandoff(payload)}
    />
  ),
})
