'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type {
  CivicPanelSummary,
  ManagedCivicPanel,
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
import { CivicPanelMilestones } from './CivicPanelMilestones'
import { CivicPanelSeats } from './CivicPanelSeats'
import { ManagedPanelControls } from './ManagedPanelControls'

export const CitizensPanelView = ({
  summary,
  managed = null,
}: {
  summary: CivicPanelSummary
  // The panel GoodParty builds for the office; null before it approves, or
  // when it could not be read.
  managed?: ManagedCivicPanel | null
}) => {
  const hasMembers = summary.members > 0
  const { progress, balance, composition } = summary
  const managedActive = managed !== null && managed.status !== 'stopped'

  const entry = useSearchParams()?.get(CIVIC_PANEL_ENTRY_PARAM) ?? 'direct'
  // Once per visit, on what the page was given.
  useEffect(() => {
    trackEvent(EVENTS.CivicPanel.PanelViewed, {
      members: summary.members,
      goalMembers: progress.goal,
      expectedAnswers: progress.expectedAnswers,
      answersFloor: progress.answersNeeded,
      groupsCovered: progress.groupsCovered,
      groupsTotal: progress.groupsTotal,
      howCloseStatus: balance ? PANEL_STATUS_PROPERTY[balance.status] : null,
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

      <CivicPanelMilestones progress={progress} composition={composition} />

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {managedActive ? <ManagedPanelControls panel={managed} /> : null}

          {balance ? (
            <CivicPanelBalanceSection
              balance={balance}
              groups={composition?.groups ?? []}
            />
          ) : null}

          {hasMembers && composition && composition.places.length > 0 ? (
            <CivicPanelSeats
              placeKind={composition.placeKind}
              places={composition.places}
              members={progress.members}
              goal={progress.goal}
            />
          ) : null}
        </div>

        {/* Beside the panel from lg, below it on a phone: the members'
            numbers. */}
        {hasMembers ? (
          <aside
            className="flex w-full flex-col gap-4 lg:w-[300px] lg:shrink-0"
            data-testid="civic-panel-aside"
          >
            <CitizensPanelStats summary={summary} />
            <Button asChild variant="outline" className="self-start">
              <Link href={CITIZENS_PANEL_LIST_PATH}>{COPY.seeMembers}</Link>
            </Button>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
