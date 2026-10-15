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
import { CivicPanelRail } from './CivicPanelRail'
import { newListHref } from '../../crm/wizard/newListPresets'

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard/contacts"
          className="flex items-center gap-1 text-sm text-muted-foreground no-underline hover:underline"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {COPY.backToContacts}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">{COPY.title}</h1>
        <p className="text-sm text-muted-foreground">
          {hasMembers ? COPY.pageCaption : COPY.caption}
        </p>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
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
                {summary.askableNow > 0 && (
                  <Button asChild variant="outline">
                    <Link href={newListHref('askableNow')}>
                      {COPY.askableNowList}
                    </Link>
                  </Button>
                )}
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

        {/* Above the plan on a phone, so the next thing to do comes first;
            beside it from lg, like the priority page's rail. */}
        <aside className="order-first w-full lg:order-none lg:w-80 lg:shrink-0">
          <CivicPanelRail
            progress={progress}
            next={activePlan ? (planState?.next ?? null) : null}
            hoursPerWeek={activePlan?.hoursPerWeek ?? null}
            onPlan={setPlanState}
          />
        </aside>
      </div>
    </div>
  )
}
