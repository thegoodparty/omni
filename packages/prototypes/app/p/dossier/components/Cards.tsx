'use client'

import { Button } from '@goodparty_org/styleguide'
import { Check, FolderOpen, Send } from 'lucide-react'
import { OUTREACH_PLAN, PAST_OUTREACH } from '../data'

const CARD_FRAME =
  'border-border bg-card rounded-xl border p-4 flex flex-col gap-3'

/**
 * The conversational beat that hands you the file. The count and the progress
 * live in the rail now, which is always on screen, so repeating them here put
 * two progress bars in one viewport.
 */
export const FileCard = ({
  note,
  onOpen,
}: {
  note: string
  onOpen: () => void
}): React.JSX.Element => (
  <div className={CARD_FRAME}>
    <div className="flex items-center gap-2">
      <FolderOpen className="size-4 text-primary" />
      <span className="text-foreground font-medium">Maple Ave file</span>
    </div>
    <p className="text-muted-foreground text-sm">{note}</p>
    <Button size="medium" onClick={onOpen} className="self-start">
      Open the file
    </Button>
  </div>
)

export const PastOutreachCard = (): React.JSX.Element => {
  return (
    <div className={CARD_FRAME}>
      <div>
        <span className="text-foreground font-medium">
          Past outreach to this audience
        </span>
        <p className="text-muted-foreground text-sm">
          Two sends, neither about Maple.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {PAST_OUTREACH.map((record, i) => (
          <div
            key={record.id}
            className="border-border rounded-lg border p-3 flex flex-col gap-1.5"
          >
            <span className="text-foreground font-medium">{record.topic}</span>
            <span className="text-muted-foreground text-sm">
              {record.date}
              {' · '}
              {record.channel}
              {' · '}
              {record.audience}
            </span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {record.sent} sent, {record.replies} replies
            </span>
            {i === 0 ? (
              <div className="bg-warning/5 border-warning/40 rounded-lg border p-3">
                <p className="text-foreground text-sm">{record.finding}</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{record.finding}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export const OutreachCard = ({
  sent,
  sending,
  onSend,
}: {
  sent: boolean
  sending: boolean
  onSend: () => void
}): React.JSX.Element => {
  const plan = OUTREACH_PLAN
  return (
    <div className={CARD_FRAME}>
      <span className="text-muted-foreground text-sm">Ready to send</span>
      <span className="text-foreground font-medium">
        {plan.audience} ({plan.count.toLocaleString()})
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Channel</span>
          <span className="text-foreground text-sm">{plan.channel}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">List</span>
          <span className="text-foreground text-sm">{plan.listName}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Goal</span>
          <span className="text-foreground text-sm">{plan.goal}</span>
        </div>
      </div>
      <div className="bg-muted/40 rounded-lg p-3">
        <p className="text-foreground text-sm">{plan.message}</p>
      </div>
      {sent ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-success" />
            <span className="text-foreground text-sm">
              Sent to 312 people, just now
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            I will read the replies and tell you what changes.
          </p>
        </div>
      ) : sending ? (
        <Button size="medium" disabled loading loadingText="Sending...">
          Sending...
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="medium" icon={<Send />} onClick={onSend}>
            Send it
          </Button>
          <Button size="medium" variant="ghost" onClick={() => {}}>
            Edit first
          </Button>
        </div>
      )}
    </div>
  )
}
