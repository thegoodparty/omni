import type { CivicPanelBuildProgress } from '@goodparty_org/contracts'
import { Card, Progress } from '@styleguide'
import { numberFormatter } from 'helpers/numberHelper'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

/**
 * Members, and how many of the district's major groups have enough of them,
 * with the bar filled by groups covered. The top of the panel page and the
 * Constituents page's civic panel section both show it.
 */
export const CivicPanelProgress = ({
  progress,
}: {
  progress: CivicPanelBuildProgress
}) => {
  const { groupsCovered, groupsTotal } = progress
  const filled = groupsTotal > 0 ? (groupsCovered / groupsTotal) * 100 : 0
  return (
    <Card
      className="gap-2.5 p-4 sm:gap-3 sm:px-7 sm:py-6"
      data-testid="civic-panel-progress"
    >
      <p className="text-lg font-bold text-foreground sm:text-xl">
        <span className="text-primary">
          {numberFormatter(progress.members)}
        </span>
        {COPY.membersLabel(progress.members)}
        {groupsTotal > 0 ? COPY.inGroups(groupsCovered, groupsTotal) : null}
      </p>
      {groupsTotal > 0 ? (
        <>
          <Progress
            value={filled}
            className="h-3 sm:h-3.5"
            aria-label={COPY.progressLabel}
            data-filled={Math.round(filled)}
          />
          <p className="text-sm text-muted-foreground">
            {groupsCovered < groupsTotal
              ? COPY.groupsMissing
              : COPY.groupsComplete}
          </p>
        </>
      ) : null}
    </Card>
  )
}
