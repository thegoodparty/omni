import Link from 'next/link'
import type { SmsOutreachReply } from '@goodparty_org/contracts'
import { SERVE_POLL_READER_COPY } from './pollResultsCopy'

const receivedLabel = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

// Only the contact-level status the reply is linked to. The reply also
// carries a phone, last name and address; none of it is shown here.
export const PollCrmPanel = ({
  crm,
  receivedAt,
}: {
  crm: SmsOutreachReply['crm']
  receivedAt: string
}) => (
  <div className="mt-2 grid gap-2 rounded-lg bg-muted/50 p-3 text-sm">
    <div>
      <p className="text-xs text-muted-foreground">
        {SERVE_POLL_READER_COPY.received}
      </p>
      <p className="text-foreground">{receivedLabel(receivedAt)}</p>
    </div>
    {crm && (
      <>
        <div>
          <p className="text-xs text-muted-foreground">
            {SERVE_POLL_READER_COPY.contactStatus}
          </p>
          <p className="text-foreground">
            {crm.statusLabel ?? SERVE_POLL_READER_COPY.noStatus}
          </p>
        </div>
        <Link
          href={`/dashboard/contacts/${encodeURIComponent(crm.contactId)}`}
          className="font-medium text-info underline"
        >
          {SERVE_POLL_READER_COPY.openRecord}
        </Link>
      </>
    )}
  </div>
)
