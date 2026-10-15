import Link from 'next/link'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { Button, Progress } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { READ_STATUS_COPY, readPercent, resultsHref } from '../readStatusCopy'

type ReadStatusProps = {
  priorityId: string
  readStatus: PriorityReadStatus
  onGetAnswers: () => void
  getAnswersDisabled?: boolean
}

const GoodReadMark = ({ size }: { size: 'small' | 'medium' }) => (
  <span
    className={
      size === 'small'
        ? 'flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
        : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
    }
  >
    <CheckIcon
      className={size === 'small' ? 'size-3' : 'size-3.5'}
      aria-hidden
    />
  </span>
)

const ReadProgress = ({
  readStatus,
  className,
}: {
  readStatus: PriorityReadStatus
  className: string
}) => (
  <Progress
    value={readPercent(readStatus.answers, readStatus.needed)}
    aria-label={READ_STATUS_COPY.progress(
      readStatus.answers,
      readStatus.needed,
    )}
    className={className}
  />
)

// Phone: one compact row under the top bar. The text and bar open the
// results page; the button is the one action.
export const ReadStatusStrip = ({
  priorityId,
  readStatus,
  onGetAnswers,
  getAnswersDisabled = false,
}: ReadStatusProps): React.JSX.Element => (
  <div className="flex items-center gap-3 px-4 pb-2.5 pt-0.5">
    {readStatus.good ? (
      <>
        <Link
          href={resultsHref(priorityId)}
          className="flex min-w-0 flex-1 items-center gap-2 text-foreground no-underline"
        >
          <GoodReadMark size="small" />
          <span className="truncate text-sm font-semibold">
            {READ_STATUS_COPY.goodRead}
          </span>
        </Link>
        <Button asChild size="small" className="shrink-0 rounded-full">
          <Link href={resultsHref(priorityId)}>
            {READ_STATUS_COPY.seeWhatWeHeard}
          </Link>
        </Button>
      </>
    ) : (
      <>
        <Link
          href={resultsHref(priorityId)}
          className="flex min-w-0 flex-1 flex-col gap-1.5 text-foreground no-underline"
        >
          <span className="truncate text-sm font-semibold">
            {READ_STATUS_COPY.moreAnswers(
              readStatus.needed - readStatus.answers,
            )}
          </span>
          <ReadProgress readStatus={readStatus} className="h-1.5" />
        </Link>
        <Button
          type="button"
          size="small"
          className="shrink-0 rounded-full"
          onClick={onGetAnswers}
          disabled={getAnswersDisabled}
        >
          {READ_STATUS_COPY.getAnswers}
        </Button>
      </>
    )}
  </div>
)

// Desktop: the top of the right rail, above "Where this stands".
export const ReadStatusRailBlock = ({
  priorityId,
  readStatus,
  onGetAnswers,
  getAnswersDisabled = false,
}: ReadStatusProps): React.JSX.Element => (
  <div className="flex flex-col gap-2.5 border-b border-border pb-4">
    {readStatus.good ? (
      <>
        <div className="flex items-center gap-2">
          <GoodReadMark size="medium" />
          <span className="text-base font-semibold text-foreground">
            {READ_STATUS_COPY.goodRead}
          </span>
        </div>
        <Button asChild size="small" className="mt-1 self-start rounded-full">
          <Link href={resultsHref(priorityId)}>
            {READ_STATUS_COPY.seeWhatWeHeard}
          </Link>
        </Button>
      </>
    ) : (
      <>
        <span className="text-base font-semibold text-foreground">
          {READ_STATUS_COPY.moreAnswers(readStatus.needed - readStatus.answers)}
        </span>
        <ReadProgress readStatus={readStatus} className="h-2" />
        <Button
          type="button"
          size="small"
          className="mt-1 self-start rounded-full"
          onClick={onGetAnswers}
          disabled={getAnswersDisabled}
        >
          {READ_STATUS_COPY.getAnswers}
        </Button>
      </>
    )}
    <Link
      href={resultsHref(priorityId)}
      className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      {READ_STATUS_COPY.whatWeHeard}
    </Link>
  </div>
)
