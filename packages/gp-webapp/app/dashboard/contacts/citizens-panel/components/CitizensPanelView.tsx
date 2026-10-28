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
  type CivicPanelStage,
} from '../citizensPanelCopy'
import {
  longDay,
  managedPanelNextInvitesAt,
  useServePlace,
} from '../managedPanelCopy'
import { CitizensPanelStats } from './CitizensPanelStats'
import { CivicPanelChatDock, useCivicPanelChat } from './CivicPanelChatDock'
import { CivicPanelHero } from './CivicPanelHero'
import { CivicPanelFirstJoin, CivicPanelNext } from './CivicPanelNext'
import { ManagedPanelControls } from './ManagedPanelControls'
import { buildBloom, buildSeats } from './panelCharts'

const stageOf = (
  members: number,
  goal: number,
  managed: ManagedCivicPanel | null,
): CivicPanelStage => {
  if (managed?.status === 'exhausted') return 'exhausted'
  if (managed?.status === 'ready' || (goal > 0 && members >= goal)) {
    return 'ready'
  }
  if (managed?.status === 'paused') return 'paused'
  return members === 0 ? 'start' : 'building'
}

export const CitizensPanelView = ({
  summary,
  managed = null,
}: {
  summary: CivicPanelSummary
  // The panel GoodParty builds for the office; null before it approves, or
  // when it could not be read.
  managed?: ManagedCivicPanel | null
}) => {
  const { progress, balance, composition } = summary
  const active =
    managed !== null && managed.status !== 'stopped' ? managed : null
  const stage = stageOf(summary.members, progress.goal, active)
  const place = useServePlace()
  const chat = useCivicPanelChat()
  // Only the first wave's day is "your first invites".
  const firstInvites =
    active && active.progress.wavesSent === 0
      ? managedPanelNextInvitesAt(active)
      : null

  const source = useSearchParams()?.get(CIVIC_PANEL_ENTRY_PARAM) ?? 'direct'
  // Once per visit, on what the page was given.
  useEffect(() => {
    trackEvent(EVENTS.Contacts.CivicPanelViewed, {
      members: summary.members,
      goalMembers: progress.goal,
      expectedAnswers: progress.expectedAnswers,
      answersFloor: progress.answersNeeded,
      groupsCovered: progress.groupsCovered,
      groupsTotal: progress.groupsTotal,
      howCloseStatus: balance ? PANEL_STATUS_PROPERTY[balance.status] : null,
      managedStatus: managed?.status ?? 'none',
      source,
      ...(managed?.status === 'building' && composition
        ? {
            groupsAtShare: buildBloom(composition.groups).atShare,
            tractsBehind: buildSeats({
              places: composition.places,
              members: summary.members,
              goal: progress.goal,
              cx: 0,
              cy: 0,
            }).behind.length,
          }
        : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* Clear of the pinned chat bar, with room to spare under the last
          card. */}
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pb-[calc(var(--chat-dock-height,5rem)+8rem)] pt-4 sm:gap-6 lg:px-12 lg:pt-8">
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

        <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
            <CivicPanelHero
              stage={stage}
              members={summary.members}
              goal={progress.goal}
              placeKind={composition?.placeKind}
              place={place}
            />
            {summary.members === 0 ? (
              <CivicPanelFirstJoin
                firstInvites={firstInvites ? longDay(firstInvites) : null}
                place={place}
              />
            ) : stage !== 'ready' && composition ? (
              <CivicPanelNext
                composition={composition}
                members={summary.members}
                goal={progress.goal}
                exhausted={stage === 'exhausted'}
                place={place}
              />
            ) : null}
          </div>

          {/* Beside the panel from lg, below it on a phone: managing the
              invites and the members' numbers. */}
          <aside
            className="flex w-full flex-col gap-4 lg:w-[320px] lg:shrink-0"
            data-testid="civic-panel-aside"
          >
            {active ? <ManagedPanelControls panel={active} /> : null}
            <CitizensPanelStats summary={summary} showReached={false} />
            {summary.members > 0 ? (
              <Button asChild variant="outline" className="self-start">
                <Link href={CITIZENS_PANEL_LIST_PATH}>{COPY.seeMembers}</Link>
              </Button>
            ) : null}
          </aside>
        </div>
      </div>
      <CivicPanelChatDock chat={chat} />
    </>
  )
}
