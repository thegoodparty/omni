import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { Button, Progress } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import {
  READ_STATUS_COPY,
  READ_STATUS_DOT,
  readPercent,
  resultsHref,
} from '../readStatusCopy'

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

const FollowUpLine = ({ readStatus }: { readStatus: PriorityReadStatus }) =>
  readStatus.followUp ? (
    <span className="text-sm text-muted-foreground">
      {READ_STATUS_COPY.followUp(
        readStatus.followUp.texts,
        format(parseISO(readStatus.followUp.scheduledLocalDate), 'MMM d'),
      )}
    </span>
  ) : null

const StatusDot = ({ readStatus }: { readStatus: PriorityReadStatus }) => (
  <span
    aria-hidden
    className={`size-2 shrink-0 rounded-full ${READ_STATUS_DOT[readStatus.status]}`}
  />
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

const GetAnswers = ({
  onGetAnswers,
  disabled,
  className,
}: {
  onGetAnswers: () => void
  disabled: boolean
  className: string
}) => (
  <Button
    type="button"
    size="small"
    className={className}
    onClick={onGetAnswers}
    disabled={disabled}
  >
    {READ_STATUS_COPY.getAnswers}
  </Button>
)

// Phone: one compact row under the top bar. The text opens the results
// page; the button is the one action.
export const ReadStatusStrip = ({
  priorityId,
  readStatus,
  onGetAnswers,
  getAnswersDisabled = false,
}: ReadStatusProps): React.JSX.Element => (
  <>
    <div className="flex items-center gap-3 px-4 pb-2.5 pt-0.5">
      {readStatus.good ? (
        <>
          <Link
            href={resultsHref(priorityId)}
            className="flex min-w-0 flex-1 items-center gap-2 text-foreground no-underline"
          >
            <GoodReadMark size="small" />
            <span className="truncate text-sm font-semibold">
              {READ_STATUS_COPY.goodLine(readStatus)}
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
            {readStatus.status === 'tooEarly' ? (
              <>
                <span className="truncate text-sm font-semibold">
                  {READ_STATUS_COPY.moreAnswers(
                    readStatus.needed - readStatus.answers,
                  )}
                </span>
                <ReadProgress readStatus={readStatus} className="h-1.5" />
              </>
            ) : (
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot readStatus={readStatus} />
                <span className="truncate text-sm font-semibold">
                  {READ_STATUS_COPY.stripLine(readStatus)}
                </span>
              </span>
            )}
          </Link>
          <GetAnswers
            onGetAnswers={onGetAnswers}
            disabled={getAnswersDisabled}
            className="shrink-0 rounded-full"
          />
        </>
      )}
    </div>
    {readStatus.followUp ? (
      <div className="px-4 pb-2.5">
        <FollowUpLine readStatus={readStatus} />
      </div>
    ) : null}
  </>
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
            {READ_STATUS_COPY.label(readStatus)}
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
        {readStatus.status === 'tooEarly' ? null : (
          <div className="flex items-center gap-2">
            <StatusDot readStatus={readStatus} />
            <span className="text-base font-semibold text-foreground">
              {READ_STATUS_COPY.label(readStatus)}
            </span>
          </div>
        )}
        {readStatus.answers < readStatus.needed ? (
          <>
            <span
              className={
                readStatus.status === 'tooEarly'
                  ? 'text-base font-semibold text-foreground'
                  : 'text-sm text-muted-foreground'
              }
            >
              {READ_STATUS_COPY.moreAnswers(
                readStatus.needed - readStatus.answers,
              )}
            </span>
            <ReadProgress readStatus={readStatus} className="h-2" />
          </>
        ) : null}
        {readStatus.underrepresented.length > 0 ? (
          <span className="text-sm text-foreground">
            {READ_STATUS_COPY.hearFromMore(readStatus.underrepresented)}
          </span>
        ) : null}
        <GetAnswers
          onGetAnswers={onGetAnswers}
          disabled={getAnswersDisabled}
          className="mt-1 self-start rounded-full"
        />
      </>
    )}
    <FollowUpLine readStatus={readStatus} />
    <Link
      href={resultsHref(priorityId)}
      className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      {READ_STATUS_COPY.whatWeHeard}
    </Link>
  </div>
)
