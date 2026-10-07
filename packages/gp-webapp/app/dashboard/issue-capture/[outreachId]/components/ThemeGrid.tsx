import { useId } from 'react'
import type { FeedbackThemeSummary } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../copy'
import ThemeCard from './ThemeCard'

// Ranked by how many conversations touched each theme, so the issue several
// people on one turf raised rises to the top. The run's own rank breaks a tie.
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
  const ranked = [...themes].sort(
    (a, b) => b.conversationCount - a.conversationCount || a.rank - b.rank,
  )

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {copy.themesHeading}
      </h2>
      {/* One column: the page is Voter Data's 560px column, where a second
          or third card per row would be a sliver at every viewport. */}
      <div className="mt-4 flex flex-col gap-4">
        {ranked.map((theme, index) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            position={index + 1}
            outreachId={outreachId}
            isServe={isServe}
          />
        ))}
      </div>
    </section>
  )
}

export default ThemeGrid
