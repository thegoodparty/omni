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
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
