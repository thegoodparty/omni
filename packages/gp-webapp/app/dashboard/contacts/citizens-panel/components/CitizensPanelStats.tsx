import type { CivicPanelSummary } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { numberFormatter } from 'helpers/numberHelper'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

const Row = ({
  label,
  detail,
  value,
}: {
  label: string
  detail?: string
  value: number
}) => (
  <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0">
    <div className="min-w-0">
      <p className="text-base">{label}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
    <span className="text-lg font-semibold tabular-nums">
      {numberFormatter(value)}
    </span>
  </div>
)

export const CitizensPanelStats = ({
  summary,
}: {
  summary: CivicPanelSummary
}) => (
  <Card className="w-full gap-0 rounded-lg py-0">
    <Row label={COPY.members} value={summary.members} />
    <Row
      label={COPY.reachedRecently}
      detail={COPY.reachedRecentlyDetail}
      value={summary.reachedRecently}
    />
    <Row
      label={COPY.askableNow}
      detail={COPY.askableNowDetail}
      value={summary.askableNow}
    />
  </Card>
)

export const CitizensPanelEmpty = () => (
  <Card className="w-full items-start gap-3 rounded-lg p-4">
    <p className="text-sm">{COPY.empty}</p>
  </Card>
)
