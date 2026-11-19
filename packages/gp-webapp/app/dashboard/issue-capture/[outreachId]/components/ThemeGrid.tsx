import { useId, useState } from 'react'
import type { FeedbackThemeSummary } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { whatWeHeardCopy } from '../../copy'
import ThemeCard from './ThemeCard'

// Ranked by how many conversations touched each theme, so the issue several
// people on one turf raised rises to the top. The run's own rank breaks a tie.
// The top three show; the rest wait behind Show more, so the themes most
// people raised are not pushed down by the long tail.
const VISIBLE_THEMES = 3

// The report's order, which a theme's own page reads too, so the number in
// its circle is the one the card it was opened from showed.
export const rankThemes = <T extends FeedbackThemeSummary>(themes: T[]): T[] =>
  [...themes].sort(
    (a, b) => b.conversationCount - a.conversationCount || a.rank - b.rank,
  )

const ThemeGrid = ({
  themes,
  outreachId,
  isServe,
}: {
  themes: FeedbackThemeSummary[]
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  const ranked = rankThemes(themes)
  const shown = expanded ? ranked : ranked.slice(0, VISIBLE_THEMES)
  const hidden = ranked.length - shown.length

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {copy.themesHeading}
      </h2>
      {/* One column: the page is Voter Data's 560px column, where a second
          or third card per row would be a sliver at every viewport. */}
      <div className="mt-4 flex flex-col gap-4">
        {shown.map((theme, index) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            position={index + 1}
            outreachId={outreachId}
            isServe={isServe}
          />
        ))}
      </div>
      {hidden > 0 && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="small"
            onClick={() => setExpanded(true)}
          >
            {copy.showMoreThemes(hidden)}
          </Button>
        </div>
      )}
    </section>
  )
}

export default ThemeGrid
