import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'
import StanceSplit from '../../../components/StanceSplit'

// The top of the theme's card on the report, kept as the top of its page:
// the rank in its circle, the title, how many conversations it came from and
// where those people stand, so the page says which theme it is the way the
// card that opened it did.
const ThemeSummary = ({
  theme,
  position,
  isServe,
}: {
  theme: FeedbackThemeDetail
  position: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)

  return (
    <Card className="p-4 md:p-6">
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
            <h2 className="font-semibold text-foreground">
              <span className="sr-only">{copy.rank(position)}:</span>{' '}
              {theme.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {copy.conversations(theme.conversationCount)}
            </p>
          </div>
        </div>
        <p className="text-sm text-foreground">{theme.summary}</p>
        <StanceSplit counts={theme.stanceCounts} isServe={isServe} />
      </div>
    </Card>
  )
}

export default ThemeSummary
