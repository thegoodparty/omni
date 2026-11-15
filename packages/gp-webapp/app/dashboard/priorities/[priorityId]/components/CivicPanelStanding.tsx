import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { managedCivicPanelQueryOptions } from '../../../contacts/citizens-panel/civicPanelSummary.query'
import { CITIZENS_PANEL_PATH } from '../../../contacts/citizens-panel/citizensPanelCopy'
import { useServePlace } from '../../../contacts/citizens-panel/managedPanelCopy'
import { civicPanelStanding } from '../readStatusCopy'

// Where the civic panel GoodParty builds for the office stands, under the
// read, so an official waiting on it sees it fill. Nothing before one is
// set up, once it is stopped, or when it cannot be read.
export const CivicPanelStanding = ({
  className,
}: {
  className?: string
}): React.JSX.Element | null => {
  const orgSlug = useOrganization()?.slug
  const place = useServePlace()
  const { data: panel } = useQuery({
    ...managedCivicPanelQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  if (!panel || panel.status === 'stopped') return null
  const { title, line } = civicPanelStanding(
    panel.status,
    panel.progress.members,
    panel.progress.goalMembers,
    place,
  )
  return (
    <Link
      href={CITIZENS_PANEL_PATH}
      data-testid="priority-civic-panel"
      className={cn('flex flex-col gap-0.5 no-underline', className)}
    >
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-sm text-muted-foreground">{line}</span>
    </Link>
  )
}
