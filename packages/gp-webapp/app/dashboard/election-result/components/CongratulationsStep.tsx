// No 'use client': ElectionResultPage, the only caller, is a client component.
import { Button } from '@styleguide'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import { BACK_TO_DASHBOARD, WON_COPY } from '../electionResultCopy'
import { SurveyCard } from './SurveyCard'

// N1: a winner without Pro gets congratulations and the feedback survey, not
// a Serve pitch. The Pro winner's screen is PrepareToServe.
export const CongratulationsStep = ({
  onBackToDashboard,
}: {
  onBackToDashboard: () => void
}): React.JSX.Element => (
  <div className="relative flex w-full flex-col gap-7">
    <div className="motion-reduce:hidden">
      <ConfettiField />
    </div>
    <div className="relative flex flex-col gap-3">
      <h1 className="text-2xl font-semibold md:text-4xl">{WON_COPY.title}</h1>
      <p className="text-lg text-muted-foreground">
        {WON_COPY.withoutPro.description}
      </p>
    </div>
    <div className="relative">
      <SurveyCard {...WON_COPY.withoutPro.survey} />
    </div>
    <Button
      type="button"
      variant="ghost"
      size="large"
      className="relative w-full"
      onClick={onBackToDashboard}
    >
      {BACK_TO_DASHBOARD}
    </Button>
  </div>
)
