import { useQueries } from '@tanstack/react-query'
import type { ChatCard, OutreachDetail } from '@goodparty_org/contracts'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import { useSmsResults } from 'app/dashboard/outreach/v2/useOutreachResults'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { CardNote, CompactCardLink, CompactCardLoading } from './cardShell'
import { pastOutreachQueryOptions } from './cardQueries'
import { outreachDetailHref, peopleCount } from './proposalPresentation'

export const SERVE_PAST_OUTREACH_COPY = {
  untitled: 'Untitled send',
  responses: (n: number) => `${n.toLocaleString()} responses`,
}

// One chip per send, opening that send in the outreach history's own
// drawer: history already owns what a send looks like after the fact.
const PastOutreachChip = ({ row }: { row: OutreachDetail }) => {
  const isText =
    row.outreachType === OUTREACH_TYPES.text ||
    row.outreachType === OUTREACH_TYPES.p2p
  const { data: results } = useSmsResults(
    row.id,
    isText && row.status === 'completed',
    'serve',
  )
  const when = row.date ?? row.createdAt
  const count = row.textCount ?? row.billableTextCount
  return (
    <CompactCardLink
      title={row.name || row.title || SERVE_PAST_OUTREACH_COPY.untitled}
      subtitle={[
        getChannelLabel(row.outreachType),
        typeof count === 'number' ? peopleCount(count) : '',
        results ? SERVE_PAST_OUTREACH_COPY.responses(results.responded) : '',
        when ? shortOutreachDate(when) : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      href={outreachDetailHref(row.id)}
    />
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
    return <CompactCardLoading />
  }

  const rows = results
    .map((result) => result.data)
    .filter((row): row is OutreachDetail => Boolean(row))

  // Every id gone means there is nothing here worth a frame around it.
  if (rows.length === 0) return null

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      {rows.map((row) => (
        <PastOutreachChip key={row.id} row={row} />
      ))}
      <CardNote>{card.note}</CardNote>
    </div>
  )
}
