import { useQueries } from '@tanstack/react-query'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { ChannelBadge } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import { useSmsResults } from 'app/dashboard/outreach/v2/useOutreachResults'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { CardLoading, CardNote, CardShell } from './cardShell'
import { pastOutreachQueryOptions } from './cardQueries'
import { outreachDetailHref, peopleCount } from './proposalPresentation'

export const SERVE_PAST_OUTREACH_COPY = {
  untitled: 'Untitled send',
  responses: (n: number) => `${n.toLocaleString()} responses`,
}

const ResponseSignal = ({ row }: { row: OutreachDetail }) => {
  const isText =
    row.outreachType === OUTREACH_TYPES.text ||
    row.outreachType === OUTREACH_TYPES.p2p
  const { data } = useSmsResults(
    row.id,
    isText && row.status === 'completed',
    'serve',
  )
  if (!data) return null
  return (
    <span className="text-muted-foreground text-xs">
      {SERVE_PAST_OUTREACH_COPY.responses(data.responded)}
    </span>
  )
}

const PastOutreachRow = ({ row }: { row: OutreachDetail }) => {
  const when = row.date ?? row.createdAt
  const count = row.textCount ?? row.billableTextCount
  return (
    <a
      href={outreachDetailHref(row.id)}
      className="hover:bg-muted/50 -mx-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-2 no-underline"
    >
      <ChannelBadge type={row.outreachType} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {row.name || row.title || SERVE_PAST_OUTREACH_COPY.untitled}
      </span>
      {typeof count === 'number' ? (
        <span className="text-muted-foreground text-xs">
          {peopleCount(count)}
        </span>
      ) : null}
      <ResponseSignal row={row} />
      {when ? (
        <span className="text-muted-foreground text-xs">
          {shortOutreachDate(when)}
        </span>
      ) : null}
    </a>
  )
}

export const PastOutreachCard = ({
  card,
}: {
  card: Extract<ChatCard, { kind: 'past_outreach' }>
}) => {
  const results = useQueries({
    queries: card.outreachIds.map((id) => pastOutreachQueryOptions(id)),
  })

  if (results.some((result) => result.isPending)) {
    return <CardLoading rows={card.outreachIds.length} />
  }

  const rows = results
    .map((result) => result.data)
    .filter((row): row is OutreachDetail => Boolean(row))

  // Every id gone means there is nothing here worth a frame around it.
  if (rows.length === 0) return null

  return (
    <CardShell>
      <div className="flex flex-col">
        {rows.map((row) => (
          <PastOutreachRow key={row.id} row={row} />
        ))}
      </div>
      <div className="mt-3">
        <CardNote>{card.note}</CardNote>
      </div>
    </CardShell>
  )
}
