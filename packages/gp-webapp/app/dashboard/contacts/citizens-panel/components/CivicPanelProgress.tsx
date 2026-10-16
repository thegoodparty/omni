import {
  PANEL_ASSUMED_REPLY_RATE,
  type CivicPanelBuildProgress,
} from '@goodparty_org/contracts'
import { Card, Progress } from '@styleguide'
import { numberFormatter } from 'helpers/numberHelper'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'

/**
 * Members toward the panel's goal, filled the way Win's campaign progress
 * fills toward the voter contacts needed to win, with why the goal is what
 * it is in answers. The top of the panel page and the Constituents page's
 * civic panel section both show it.
 */
export const CivicPanelProgress = ({
  progress,
}: {
  progress: CivicPanelBuildProgress
}) => {
  const filled =
    progress.goal > 0
      ? Math.min((progress.members / progress.goal) * 100, 100)
      : 0
  return (
    <Card
      className="gap-2.5 p-4 sm:gap-3 sm:px-7 sm:py-6"
      data-testid="civic-panel-progress"
    >
      <div className="flex items-baseline justify-between gap-6">
        <p className="text-lg font-bold text-foreground sm:text-xl">
          <span className="text-primary">
            {numberFormatter(progress.members)}
          </span>
          {COPY.ofGoal(numberFormatter(progress.goal))}
        </p>
        <p className="hidden text-base text-muted-foreground sm:block">
          {COPY.answersToday(numberFormatter(progress.expectedAnswers))}
        </p>
      </div>
      <Progress
        value={filled}
        className="h-3 sm:h-3.5"
        aria-label={COPY.progressLabel}
        data-filled={Math.round(filled)}
      />
      <p className="text-sm text-muted-foreground">
        {COPY.goalWhy(
          Math.round(PANEL_ASSUMED_REPLY_RATE * 10),
          numberFormatter(progress.goal),
          numberFormatter(progress.answersNeeded),
        )}
      </p>
    </Card>
  )
}
