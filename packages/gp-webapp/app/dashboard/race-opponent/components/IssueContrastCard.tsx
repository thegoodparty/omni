import type { RaceOpponentIssueContrast } from 'gpApi/api-endpoints'
import SourceAttribution from './SourceAttribution'

// Display-only. Deliberately NOT the v1 ContrastCard (which carries edit/route/
// Start actions and a CampaignPosition data source). This card only renders the
// relaxed analysis contrast: no "What to do" sub-card, no Start/route buttons.
// Rendered inside a per-issue accordion in RaceOpponentList, so the issue title
// lives in the accordion trigger and this body omits it.

type Props = {
  contrast: RaceOpponentIssueContrast
  // The opponent's name labels their position column (vs "You" for the
  // candidate).
  opponentName: string
}

const IssueContrastCard = ({
  contrast,
  opponentName,
}: Props): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-3">
    <div className="flex w-full min-w-0 flex-col gap-1">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Why this matters to constituents
      </h5>
      <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
        {contrast.whyItMatters}
      </p>
    </div>

    <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-card p-3">
        <h5 className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {opponentName}
        </h5>
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {contrast.opponentStance}
        </p>
        {contrast.opponentSources && contrast.opponentSources.length > 0 && (
          <div className="flex flex-col gap-1">
            {contrast.opponentSources.map((source) => {
              // sourceUrl is the legacy passthrough (ENG-10630); url is the
              // rich field the contract always backfills.
              const url = source.sourceUrl ?? source.url
              return (
                <SourceAttribution
                  key={url}
                  sourceUrl={url}
                  sourceType="source"
                  label={url}
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-card p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          You
        </h5>
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {contrast.candidateStance}
        </p>
      </div>
    </div>
  </div>
)

export default IssueContrastCard
