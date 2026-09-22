'use client'

import { useState } from 'react'
import {
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
  // The label says what ONE press will do, not how many responses exist. The
  // server caps a page at SMS_OUTREACH_REPLIES_MAX_LIMIT, so on a large send
  // a press loads that many and no more — "Show all 2,500 responses" was a
  // promise the press could not keep, and it read as though the whole list
  // were about to land in the drawer.
  loadMore: (n: number) => `Load ${n.toLocaleString()} more`,
  loadLast: (n: number) =>
    n === 1 ? 'Load the last response' : `Load the last ${n} responses`,
  // Position in the list, so the button is not the only thing telling you
  // how much is left.
  showingOf: (shown: number, total: number) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`,
  loadingMore: 'Loading…',
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
  const repliesQuery = useServeSmsReplies(outreachId, true)

  if (repliesQuery.isError) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.failed}
        </p>
      </DetailsSection>
    )
  }

  const pages = repliesQuery.data?.pages
  if (!pages?.length) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.loading}
        </p>
      </DetailsSection>
    )
  }

  // The newest page's total, not the first's: a reply that landed while the
  // drawer was open would otherwise leave the header quoting a stale number.
  const total = pages[pages.length - 1]!.total
  const replies = pages.flatMap((page) => page.replies)

  if (total === 0) {
    return (
      <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.empty}
        </p>
      </DetailsSection>
    )
  }

  // Bounded on purpose: a press loads one server page and stops. At a few
  // thousand replies a single "show all" would put every row in the drawer
  // at once, and nobody reads 2,500 texts by scrolling anyway — the answer
  // to volume is filtering, which v1 does not have yet.
  const remaining = total - replies.length
  const moreLabel =
    remaining > SMS_OUTREACH_REPLIES_MAX_LIMIT
      ? SERVE_SMS_REPLIES_COPY.loadMore(SMS_OUTREACH_REPLIES_MAX_LIMIT)
      : SERVE_SMS_REPLIES_COPY.loadLast(remaining)

  return (
    <DetailsSection title={SERVE_SMS_REPLIES_COPY.sectionTitle}>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-4" />
          {SERVE_SMS_REPLIES_COPY.count(total)}
        </div>
        <ul className="border-t border-border">
          {replies.map((reply) => (
            <ReplyRow key={reply.id} reply={reply} />
          ))}
        </ul>
      </div>
      {repliesQuery.hasNextPage && (
        <p className="text-xs text-muted-foreground">
          {SERVE_SMS_REPLIES_COPY.showingOf(replies.length, total)}
        </p>
      )}
      {repliesQuery.hasNextPage && (
        <Button
          type="button"
          variant="link"
          disabled={repliesQuery.isFetchingNextPage}
          className="h-auto px-0 no-underline has-[>svg]:px-0"
          onClick={() => {
            void repliesQuery.fetchNextPage()
          }}
        >
          {repliesQuery.isFetchingNextPage
            ? SERVE_SMS_REPLIES_COPY.loadingMore
            : moreLabel}
        </Button>
      )}
    </DetailsSection>
  )
}
