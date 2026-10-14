import Link from 'next/link'
import type { CivicPanelSummary } from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { numberFormatter } from 'helpers/numberHelper'
import {
  CHIEF_OF_STAFF_PATH,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'

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
      <p className="text-sm">{label}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
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
    <Row label={COPY.askableNow} value={summary.askableNow} />
  </Card>
)

export const CitizensPanelEmpty = () => (
  <Card className="w-full items-start gap-3 rounded-lg p-4">
    <p className="text-sm">
      {COPY.empty}{' '}
      <span className="text-muted-foreground">{COPY.emptyAction}</span>
    </p>
    <Button asChild size="small" variant="outline">
      <Link href={CHIEF_OF_STAFF_PATH}>{COPY.buildPanel}</Link>
    </Button>
  </Card>
)
