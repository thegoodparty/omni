import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { Avatar, Card, CardContent } from '@styleguide'
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
    <Card>
      <CardContent>
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
              <h2 className="font-semibold text-foreground">
                <span className="sr-only">{copy.rank(position)}:</span>{' '}
                {theme.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {copy.conversations(theme.conversationCount)}
              </p>
            </div>
          </div>
          <p className="text-base text-foreground">{theme.summary}</p>
          {/* Null when every member is a text reply, which carries no stance:
            four zeros would read as a finding. */}
          {theme.stanceCounts !== null && (
            <StanceSplit counts={theme.stanceCounts} isServe={isServe} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default ThemeSummary
