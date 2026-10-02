import { useQuery } from '@tanstack/react-query'
import type {
  ConstituentFeedbackRecord,
  ConstituentFeedbackStance,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { MessageSquareIcon } from '@styleguide'
import { InfoSection } from './InfoSection'

// On a voter's record and on a constituent's, so the copy is mode-keyed
// (docs/product-vocabulary.md) and the Serve branch is where the vocabulary
// gate reads it. The two read the same today because nothing here names the
// person: Win must never say constituent, and Serve must never say voter.
const FEEDBACK_COPY = {
  win: {
    title: 'What they told us',
    empty: 'Nothing recorded yet.',
    unconfirmed: 'Not yet reviewed',
    wants: 'Wants',
  },
  serve: {
    title: 'What they told us',
    empty: 'Nothing recorded yet.',
    unconfirmed: 'Not yet reviewed',
    wants: 'Wants',
  },
}

const STANCE_LABELS: Record<
  'win' | 'serve',
  Record<ConstituentFeedbackStance, string>
> = {
  win: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
  serve: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
}

const CHANNEL_LABELS: Record<string, string> = {
  door_knock: 'At the door',
  phone_bank: 'On the phone',
}

const formatDate = (value: Date): string =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const FeedbackRow = ({
  entry,
  mode,
}: {
  entry: ConstituentFeedbackRecord
  mode: 'win' | 'serve'
}) => (
  <div className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm font-semibold text-foreground">
        {entry.issueLabel ?? FEEDBACK_COPY[mode].empty}
      </span>
      {entry.stance !== null && (
        <span className="text-sm text-muted-foreground">
          · {STANCE_LABELS[mode][entry.stance]}
        </span>
      )}
    </div>

    {entry.desiredOutcome !== null && (
      <p className="text-sm text-foreground">
        {FEEDBACK_COPY[mode].wants}: {entry.desiredOutcome}
      </p>
    )}

    {/* The memo itself, kept under the triple rather than replacing it. The
        canvasser recorded this about the person, so it is their own summary
        and not a quotation — see the module's Prisma comment. */}
    {entry.transcript !== null && (
      <p className="text-sm italic text-muted-foreground">{entry.transcript}</p>
    )}

    <p className="text-xs text-muted-foreground">
      {CHANNEL_LABELS[entry.channel] ?? entry.channel}
      {' · '}
      {formatDate(entry.occurredAt)}
      {entry.actorName !== null && ` · ${entry.actorName}`}
      {/* An unconfirmed row is a model's reading that nobody who was there
          has checked. Saying so here is the same honesty the reporting owes
          later: it is not evidence until a person agreed with it. */}
      {entry.confirmedAt === null && ` · ${FEEDBACK_COPY[mode].unconfirmed}`}
    </p>
  </div>
)

// Renders nothing at all until there is something to show. An empty card on
// every contact would be a permanent promise the feature has not kept yet,
// and this section is additive to a surface that is already long.
export const ConstituentFeedbackSection = ({
  personId,
  isServe,
}: {
  personId: string
  isServe: boolean
}) => {
  const mode = isServe ? 'serve' : 'win'
  const { data } = useQuery({
    queryKey: ['constituent-feedback', personId],
    queryFn: () =>
      clientRequest('GET /v1/constituent-feedback', { personId }).then(
        (res) => res.data,
      ),
  })

  const entries = data?.feedback ?? []
  if (entries.length === 0) return null

  return (
    <InfoSection
      title={FEEDBACK_COPY[mode].title}
      icon={<MessageSquareIcon size={24} />}
    >
      {entries.map((entry) => (
        <FeedbackRow key={entry.id} entry={entry} mode={mode} />
      ))}
    </InfoSection>
  )
}
