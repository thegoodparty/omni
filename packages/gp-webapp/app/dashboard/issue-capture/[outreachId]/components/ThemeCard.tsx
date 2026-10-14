import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { FeedbackThemeSummary } from '@goodparty_org/contracts'
import {
  Avatar,
  Button,
  Card,
  CardContent,
  ChevronRightIcon,
} from '@styleguide'
import { whatWeHeardCopy } from '../../copy'
import { RETURN_PARAM, safeReturnPath, withReturnPath } from '../../returnPath'
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
  const from = safeReturnPath(useSearchParams()?.get(RETURN_PARAM) ?? null)

  return (
    <Card>
      <CardContent>
        <div className="flex h-full flex-col justify-between gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              {/* The badge is a picture of the rank; the heading says it, so a
                screen reader hears "Rank 1: Street flooding" once. */}
              <Avatar size="large" aria-hidden="true">
                {/* The secondary family's tint, with no ring: Avatar has no colour
                  variant, so its fallback takes the theme token here. */}
                <Avatar.Fallback className="border-0 bg-secondary-light text-secondary-dark">
                  #{position}
                </Avatar.Fallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">
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
            <p className="text-base text-foreground">{theme.summary}</p>
            {/* Null when every member is a text reply, which carries no
              stance: four zeros would read as a finding. */}
            {theme.stanceCounts !== null && (
              <StanceSplit counts={theme.stanceCounts} isServe={isServe} />
            )}
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link
              href={withReturnPath(
                `/dashboard/issue-capture/${outreachId}/theme/${theme.id}`,
                from,
              )}
              aria-label={copy.seeDetailsFor(theme.title)}
            >
              {copy.seeDetails}
              <ChevronRightIcon />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default ThemeCard
