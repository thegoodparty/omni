'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  answersNeeded,
  panelExpectedAnswers,
  panelGoalMembers,
  type CivicPanelBuildPlanResponse,
  type CivicPanelSummary,
  type ManagedCivicPanel,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PANEL_STATUS_PROPERTY } from 'app/dashboard/priorities/[priorityId]/readStatusProperty'
import {
  CITIZENS_PANEL_LIST_PATH,
  CIVIC_PANEL_ENTRY_PARAM,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { CitizensPanelStats } from './CitizensPanelStats'
import { CivicPanelBalanceSection } from './CivicPanelBalance'
import { CivicPanelPlanStart } from './CivicPanelPlanStart'
import { CivicPanelPlanSteps } from './CivicPanelPlanSteps'
import { CivicPanelMilestones } from './CivicPanelMilestones'
import { CivicPanelRail } from './CivicPanelRail'
import { CivicPanelSeats } from './CivicPanelSeats'
import { ManagedPanelControls } from './ManagedPanelControls'

export const CitizensPanelView = ({
  summary,
  plan: initialPlan,
  managed = null,
}: {
  summary: CivicPanelSummary
  // Null when the plan could not be read; its own `plan` is null before the
  // official has made one.
  plan: CivicPanelBuildPlanResponse | null
  // The panel GoodParty builds for the office; null before it approves, or
  // when it could not be read.
  managed?: ManagedCivicPanel | null
}) => {
  const [planState, setPlanState] = useState(initialPlan)
  const hasMembers = summary.members > 0
  // Without the plan's read there is no district mix at hand, so the goal is
  // sized for the smallest major group any district can have.
  const progress = planState?.progress ?? {
    members: summary.members,
    goal: panelGoalMembers(answersNeeded()),
    answersNeeded: answersNeeded(),
    expectedAnswers: panelExpectedAnswers(summary.members),
    groupsCovered: 0,
    groupsTotal: 0,
  }
  const activePlan =
    planState?.plan?.status === 'active' ? planState.plan : null
  const underGoal = progress.members < progress.goal
  // GoodParty builds this office's panel, so there is no plan to start.
  const managedActive = managed !== null && managed.status !== 'stopped'

  const entry = useSearchParams()?.get(CIVIC_PANEL_ENTRY_PARAM) ?? 'direct'
  // Once per visit, on what the page was given, not on later plan changes.
  useEffect(() => {
    trackEvent(EVENTS.CivicPanel.PanelViewed, {
      members: summary.members,
      goalMembers: progress.goal,
      expectedAnswers: progress.expectedAnswers,
      answersFloor: progress.answersNeeded,
      groupsCovered: progress.groupsCovered,
      groupsTotal: progress.groupsTotal,
      planStatus: initialPlan?.plan?.status ?? 'none',
      howCloseStatus: initialPlan?.balance
        ? PANEL_STATUS_PROPERTY[initialPlan.balance.status]
        : null,
      entry,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 p-4 sm:gap-6 lg:px-12 lg:py-8">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <Link
          href="/dashboard/contacts"
          aria-label={COPY.backToContacts}
          className="flex px-1 py-2.5 text-foreground sm:p-0"
        >
          <ArrowLeftIcon className="size-[22px]" aria-hidden />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground sm:text-[28px]">
          {COPY.title}
        </h1>
      </div>

      <CivicPanelMilestones
        progress={progress}
        composition={planState?.composition ?? null}
      />

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {managedActive ? <ManagedPanelControls panel={managed} /> : null}

          {planState === null && !managedActive ? (
            <p className="text-sm text-muted-foreground">
              {COPY.planLoadError}
            </p>
          ) : activePlan ? (
            <CivicPanelPlanSteps
              plan={activePlan}
              next={planState?.next ?? null}
              onPlan={setPlanState}
            />
          ) : managedActive ? null : (
            <CivicPanelPlanStart keepFresh={!underGoal} onPlan={setPlanState} />
          )}

          {planState?.balance ? (
            <CivicPanelBalanceSection
              balance={planState.balance}
              groups={planState.composition?.groups ?? []}
            />
          ) : null}

          {hasMembers &&
          planState?.composition &&
          planState.composition.places.length > 0 ? (
            <CivicPanelSeats
              placeKind={planState.composition.placeKind}
              places={planState.composition.places}
              members={progress.members}
              goal={progress.goal}
            />
          ) : null}
        </div>

        {/* Beside the plan from lg, below it on a phone: the weekly time
            (only a plan has one to change), then the members' numbers. */}
        {activePlan || hasMembers ? (
          <aside
            className="flex w-full flex-col gap-4 lg:w-[300px] lg:shrink-0"
            data-testid="civic-panel-aside"
          >
            {activePlan ? (
              <CivicPanelRail
                hoursPerWeek={activePlan.hoursPerWeek}
                onPlan={setPlanState}
              />
            ) : null}
            {hasMembers ? (
              <>
                <CitizensPanelStats summary={summary} />
                <Button asChild variant="outline" className="self-start">
                  <Link href={CITIZENS_PANEL_LIST_PATH}>{COPY.seeMembers}</Link>
                </Button>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
