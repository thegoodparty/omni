'use client'

import { useState } from 'react'
import {
  SMS_OUTREACH_REPLIES_DEFAULT_LIMIT,
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  type SmsOutreachReply,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import {
  ChevronDownIcon,
  MessageSquareIcon,
} from '@styleguide/components/ui/icons'
import { DetailsSection } from './listDetails/ListDetailsMetric'
import { useServeSmsReplies } from './useOutreachResults'

// Every user-facing string in this component, in one SERVE_* declaration.
// The name is load-bearing rather than decorative: scripts/serveVocabulary.ts
// reads a `SERVE_*` initializer as a Serve copy region, and it cannot infer
// that from this file's location — `outreach/v2/` is mounted by both products
// and is full of legitimate Win copy — nor from the `isServe &&` that gates
// the only call site, which lives in another file. Written inline, these
// strings would be invisible to the gate. Same reasoning, and the same
// mistake, as SERVE_FOLLOW_UP_COPY in FollowUpOutstandingSection.tsx.
const SERVE_SMS_REPLIES_COPY = {
  sectionTitle: 'Responses',
  empty: 'No responses yet. They appear here as constituents reply.',
  failed: "We couldn't load the responses. Close and try again.",
  loading: 'Loading responses',
  anonymous: 'Constituent',
  optedOut: 'Opted out',
  expand: 'Show contact details',
  collapse: 'Hide contact details',
  phoneLabel: 'Phone',
  locationLabel: 'Location',
  receivedLabel: 'Received',
  showAll: (total: number) => `Show all ${total.toLocaleString()} responses`,
  count: (total: number) =>
    `${total.toLocaleString()} response${total === 1 ? '' : 's'}`,
} as const

// The design's collapsed line is first name only; the full name and the rest
// of the CRM facts live behind the expander.
const displayName = (reply: SmsOutreachReply): string =>
  reply.firstName?.trim() || SERVE_SMS_REPLIES_COPY.anonymous

const fullName = (reply: SmsOutreachReply): string =>
  [reply.firstName, reply.lastName].filter(Boolean).join(' ').trim() ||
  SERVE_SMS_REPLIES_COPY.anonymous

const location = (reply: SmsOutreachReply): string =>
  [reply.city, reply.state].filter(Boolean).join(', ') || '—'

const receivedLabel = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

const CrmFact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="truncate text-sm text-foreground">{value}</p>
  </div>
)

const ReplyRow = ({ reply }: { reply: SmsOutreachReply }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="border-t border-border px-3 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{displayName(reply)}</span>
        {reply.isOptOut && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {SERVE_SMS_REPLIES_COPY.optedOut}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm whitespace-pre-line text-foreground">
        {reply.content}
      </p>
      <Button
        type="button"
        variant="link"
        aria-expanded={expanded}
        className="h-auto px-0 text-xs no-underline has-[>svg]:px-0"
        onClick={() => setExpanded((open) => !open)}
      >
        <ChevronDownIcon
          className={expanded ? 'size-3 rotate-180' : 'size-3'}
        />
        {expanded
          ? SERVE_SMS_REPLIES_COPY.collapse
          : SERVE_SMS_REPLIES_COPY.expand}
      </Button>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
          <CrmFact label="Name" value={fullName(reply)} />
          <CrmFact
            label={SERVE_SMS_REPLIES_COPY.phoneLabel}
            value={reply.phone ?? '—'}
          />
          <CrmFact
            label={SERVE_SMS_REPLIES_COPY.locationLabel}
            value={location(reply)}
          />
          <CrmFact
            label={SERVE_SMS_REPLIES_COPY.receivedLabel}
            value={receivedLabel(reply.receivedAt)}
          />
        </div>
      )}
    </li>
  )
}

/**
 * The read-only reply list from the design's comments section: first name,
 * content, and an expandable CRM panel.
 *
 * Deliberately missing, and not a stub: the heart, the unread dot, the reply
 * composer, and the three filters that depend on read state. A working thread
 * needs per-person outbound SMS the Slack fulfilment path does not have, and
 * the other two need a flags table nothing writes yet. All three are deferred
 * for v1 (docs/features/serve-sms.md, "Out of scope in v1"), which leaves
 * "All" as the only filter — so there is no filter control here at all rather
 * than a single-option one pretending to be one.
 *
 * Serve-only by construction, not only by gating: reply CONTENT is stored
 * only for sends that came back through the shared ingest, and Win's Peerly
 * sweep records timestamps without bodies.
 */
export const ServeSmsRepliesSection = ({
  outreachId,
}: {
  outreachId: number
}): React.JSX.Element => {
  const [limit, setLimit] = useState(SMS_OUTREACH_REPLIES_DEFAULT_LIMIT)
  const repliesQuery = useServeSmsReplies(outreachId, true, limit)

  if (repliesQuery.isError) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.failed}
        </p>
      </DetailsSection>
    )
  }

  const data = repliesQuery.data
  if (!data) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.loading}
        </p>
      </DetailsSection>
    )
  }

  if (data.total === 0) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.empty}
        </p>
      </DetailsSection>
    )
  }

  return (
    <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-4" />
          {SERVE_SMS_REPLIES_COPY.count(data.total)}
        </div>
        <ul className="border-t border-border">
          {data.replies.map((reply) => (
            <ReplyRow key={reply.id} reply={reply} />
          ))}
        </ul>
      </div>
      {/* Hidden once the page is the server's ceiling: the button would
          otherwise stay up on a send with more than MAX replies and do
          nothing, since a larger limit is clamped back to the same page. */}
      {data.replies.length < data.total &&
        limit < SMS_OUTREACH_REPLIES_MAX_LIMIT && (
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 no-underline has-[>svg]:px-0"
            onClick={() =>
              setLimit(Math.min(data.total, SMS_OUTREACH_REPLIES_MAX_LIMIT))
            }
          >
            {SERVE_SMS_REPLIES_COPY.showAll(data.total)}
          </Button>
        )}
    </DetailsSection>
  )
}
