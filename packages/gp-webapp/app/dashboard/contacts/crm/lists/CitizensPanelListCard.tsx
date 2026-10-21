import { useQuery } from '@tanstack/react-query'
import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'
import { Button, Card, UserIcon } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { dateUsHelper } from 'helpers/dateHelper'
import { civicPanelSummaryQueryOptions } from '../../citizens-panel/civicPanelSummary.query'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../../citizens-panel/citizensPanelCopy'
import { useContactsTable } from '../ContactsTableProvider'

// Serve's built-in "Civic panel" row: like All constituents, a view with
// no saved list behind it, so it is always the current members and never
// duplicated. Shown once the office has a member.
export const CitizensPanelListCard = () => {
  const { isWinContext, isWinContextReady, selectList } = useContactsTable()
  const flag = useServeCitizenPanelsFlag(false)
  const orgSlug = useOrganization()?.slug
  const show = isWinContextReady && !isWinContext && flag.ready && flag.enabled

  const query = useQuery({
    ...civicPanelSummaryQueryOptions(orgSlug),
    enabled: show && Boolean(orgSlug),
  })
  const members = query.data?.members ?? 0
  // The summary carries the newest row of the sheet's outreach history, so
  // this line agrees with it without the sheet's voter-file aggregates.
  const lastOutreachAt = query.data?.lastOutreachAt

  if (!show || members === 0) return null

  return (
    <Card className="w-full gap-2 rounded-2xl p-4 shadow-xs">
      <h3 className="text-base font-semibold">{COPY.listTitle}</h3>
      <p className="text-[13px] text-muted-foreground">
        {lastOutreachAt
          ? `Last outreach ${dateUsHelper(lastOutreachAt)}`
          : 'No outreach yet'}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserIcon className="size-3.5" aria-hidden />
          {members.toLocaleString()}
        </span>
        <Button
          variant="ghost"
          size="small"
          className="h-8 px-3 text-xs text-primary hover:bg-primary/5"
          onClick={() => selectList(CIVIC_PANEL_SEGMENT)}
        >
          Details
        </Button>
      </div>
    </Card>
  )
}
