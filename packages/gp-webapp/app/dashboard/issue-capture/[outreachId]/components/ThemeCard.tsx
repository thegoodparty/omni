import Link from 'next/link'
import type { FeedbackThemeSummary } from '@goodparty_org/contracts'
import { Button, Card, ChevronRightIcon } from '@styleguide'
import { whatWeHeardCopy } from '../../copy'
import StanceSplit from './StanceSplit'

interface ThemeCardProps {
  theme: FeedbackThemeSummary
  // Where it sits on the page, which is by conversations, not the run's own
  // rank: the count is read now, the rank was fixed when the run wrote it.
  position: number
  outreachId: number
  isServe: boolean
}

const ThemeCard = ({
  theme,
  position,
  outreachId,
  isServe,
}: ThemeCardProps) => {
  const copy = whatWeHeardCopy(isServe)

  return (
    <Card className="p-4 md:p-6">
      <div className="flex h-full flex-col justify-between gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center">
            {/* The badge is a picture of the rank; the heading says it, so a
                screen reader hears "Rank 1: Street flooding" once. */}
            <div
              aria-hidden="true"
              className="mr-4 flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-light text-sm font-semibold text-secondary-dark"
            >
              #{position}
            </div>
            <div className="min-w-0">
              <h3 className="font-medium text-foreground">
                <span className="sr-only">{copy.rank(position)}:</span>{' '}
                {theme.title}
              </h3>
              {/* A note can touch two themes, so this is conversations that
                  touched this one, never a share of the effort. */}
              <p className="text-sm text-muted-foreground">
                {copy.conversations(theme.conversationCount)}
              </p>
            </div>
          </div>
          <p className="text-sm text-foreground">{theme.summary}</p>
          <StanceSplit counts={theme.stanceCounts} isServe={isServe} />
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link
            href={`/dashboard/issue-capture/${outreachId}/theme/${theme.id}`}
            aria-label={copy.seeDetailsFor(theme.title)}
          >
            {copy.seeDetails}
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>
    </Card>
  )
}

export default ThemeCard
