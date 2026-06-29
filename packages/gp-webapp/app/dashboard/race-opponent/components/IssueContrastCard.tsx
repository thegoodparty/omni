import { Badge, Card, cn } from '@styleguide'
import type {
  IssueSalience,
  RaceOpponentIssueContrast,
} from 'gpApi/api-endpoints'
import SourceAttribution from './SourceAttribution'

// Display-only. Deliberately NOT the v1 ContrastCard (which carries edit/route/
// Start actions and a CampaignPosition data source). This card only renders the
// relaxed analysis contrast: no "What to do" sub-card, no Start/route buttons.

const SALIENCE_LABEL: Record<IssueSalience, string> = {
  high: 'High voter salience',
  medium: 'Medium voter salience',
  low: 'Low voter salience',
}

const SALIENCE_CLASS: Record<IssueSalience, string> = {
  high: 'bg-info-50 text-info-600 border-info-600/20',
  medium: 'bg-muted text-muted-foreground border-border',
  low: 'bg-muted text-muted-foreground border-border',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ballotpedia: 'Ballotpedia',
  opponent_website: 'Opponent website',
  campaign_plan_db: 'Campaign plan',
}

type Props = {
  contrast: RaceOpponentIssueContrast
}

const IssueContrastCard = ({ contrast }: Props): React.JSX.Element => (
  <Card className="w-full min-w-0 gap-3 p-4">
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
      <h4 className="min-w-0 break-words text-base font-semibold text-foreground">
        {contrast.issue}
      </h4>
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
          SALIENCE_CLASS[contrast.salience],
        )}
      >
        {SALIENCE_LABEL[contrast.salience]}
      </Badge>
    </div>

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
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Their position
        </h5>
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {contrast.opponentStance}
        </p>
        {contrast.opponentSources && contrast.opponentSources.length > 0 && (
          <div className="flex flex-col gap-1">
            {contrast.opponentSources.map((source) => (
              <SourceAttribution
                key={`${source.sourceType}-${source.sourceUrl}`}
                sourceUrl={source.sourceUrl}
                sourceType={SOURCE_TYPE_LABELS[source.sourceType] ?? 'Source'}
                label={source.sourceUrl}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-info-600/20 bg-info-50 p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-info-600">
          Your position
        </h5>
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {contrast.candidateStance}
        </p>
      </div>
    </div>
  </Card>
)

export default IssueContrastCard
