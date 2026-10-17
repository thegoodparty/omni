'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  answersNeeded,
  panelExpectedAnswers,
  panelGoalMembers,
  type CivicPanelBuildPlanResponse,
  type CivicPanelRepresentation,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { RepresentationBars } from 'app/dashboard/priorities/[priorityId]/results/components/RepresentationBars'
import {
  CITIZENS_PANEL_LIST_PATH,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { CitizensPanelStats } from './CitizensPanelStats'
import { CivicPanelPlanStart } from './CivicPanelPlanStart'
import { CivicPanelPlanSteps } from './CivicPanelPlanSteps'
import { CivicPanelProgress } from './CivicPanelProgress'
import { CivicPanelRail } from './CivicPanelRail'

export const CitizensPanelView = ({
  summary,
  representation,
  plan: initialPlan,
}: {
  summary: CivicPanelSummary
  // Null when the comparison could not be read; its own `representation` is
  // null below the minimum number of members.
  representation: CivicPanelRepresentation | null
  // Null when the plan could not be read; its own `plan` is null before the
  // official has made one.
  plan: CivicPanelBuildPlanResponse | null
}) => {
  const [planState, setPlanState] = useState(initialPlan)
  const hasMembers = summary.members > 0
  // Without the plan's read there is no district population at hand, so the
  // goal is the uncorrected one.
  const progress = planState?.progress ?? {
    members: summary.members,
    goal: panelGoalMembers(null),
    answersNeeded: answersNeeded(null),
    expectedAnswers: panelExpectedAnswers(summary.members),
  }
  const activePlan =
    planState?.plan?.status === 'active' ? planState.plan : null
  const underGoal = progress.members < progress.goal

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

      <CivicPanelProgress progress={progress} />

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {planState === null ? (
            <p className="text-sm text-muted-foreground">
              {COPY.planLoadError}
            </p>
          ) : activePlan ? (
            <CivicPanelPlanSteps
              plan={activePlan}
              next={planState.next}
              onPlan={setPlanState}
            />
          ) : underGoal ? (
            <CivicPanelPlanStart onPlan={setPlanState} />
          ) : null}

          {hasMembers ? (
            <>
              <CitizensPanelStats summary={summary} />
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={CITIZENS_PANEL_LIST_PATH}>{COPY.seeMembers}</Link>
                </Button>
              </div>
              <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {COPY.representationTitle}
                  </h2>
                  {representation?.representation && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {COPY.representationCaption}
                    </p>
                  )}
                </div>
                {representation === null ? (
                  <p className="text-sm text-muted-foreground">
                    {COPY.representationError}
                  </p>
                ) : representation.representation ? (
                  <RepresentationBars
                    representation={representation.representation}
                    shares={COPY.shares}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {summary.members < MIN_RESPONDENTS_FOR_REPRESENTATION
                      ? COPY.representationEmpty(
                          MIN_RESPONDENTS_FOR_REPRESENTATION,
                        )
                      : COPY.representationUnmapped}
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>

        {/* Beside the plan from lg, below it on a phone. Only a plan has a
            weekly time to change. */}
        {activePlan ? (
          <aside className="w-full lg:w-[300px] lg:shrink-0">
            <CivicPanelRail
              hoursPerWeek={activePlan.hoursPerWeek}
              onPlan={setPlanState}
            />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
