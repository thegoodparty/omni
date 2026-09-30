'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { campaignTurfsQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'
import { TurfSummaryRow } from 'app/dashboard/door-knocking/native/TurfSummaryRow'
import { DetailsSection } from './listDetails/ListDetailsMetric'
import { CONTINUE_LABELS, UNROUTED_LABEL } from './listDetails/footerMode'

// The compact in-drawer sibling list for a door-knocking campaign anchor.
// One row per turf in the campaign. It carried an "Add another turf" link
// into the create flow scoped to this campaign, and that is gone: the map
// preview above is the way back to the surface that cuts turfs, and a
// second door into the same flow from a list of finished ones is a control
// competing with the thing the section is for. Deliberately NOT a full map: the drawer's 608px column would
// force VoterMapCanvas into a shape it was not designed for, and the same
// candidate is one navigation away from the door-knocking page where the
// campaign's interactive canvas already lives (ENG-11055).
//
// Reads through `GET /v1/door-knocking/campaigns/:anchorId`. That query is
// deliberately separate from `useOutreachDetail` above it: this list churns
// when a turf is renamed, archived or deleted, and refetching the drawer's
// whole OutreachDetail on every one of those would repaint the header and
// the progress bar. Independent invalidation keeps each cache honest about
// its own scope.
interface CampaignTurfListProps {
  // Which product's event names this list's lifecycle writes report under.
  isServe: boolean
  anchorOutreachId: number
  outreachId: number
  // A row's overlays — its confirm dialog and its assignee menu — portal out
  // of the drawer this section sits in, so their clicks land as
  // outside-interactions and would dismiss the sheet mid-write. The bug the
  // drawer's own confirms already record; dismissing the assignee menu hit
  // it again. The row reports that one is up and the drawer decides what it
  // means, rather than the drawer owning overlays for turfs it has none of.
  onOverlayOpenChange?: (open: boolean) => void
  // Raised with the turf's own id once a per-row Done lands. The campaign's
  // status lives on the history row, which is a snapshot the hub holds and
  // this write never goes through — so the drawer has to be told, or its
  // footer keeps reading a campaign that is no longer in progress.
  onTurfCompleted?: (turfId: number) => void
}

export const CampaignTurfList = ({
  isServe,
  anchorOutreachId,
  outreachId,
  onOverlayOpenChange,
  onTurfCompleted,
}: CampaignTurfListProps) => {
  const query = useQuery(campaignTurfsQueryOptions(anchorOutreachId))
  const turfs = query.data ?? []

  return (
    <DetailsSection title="Turfs in this campaign">
      {/* 24px between cards. Each one is two stacked halves with its own
          internal rule, so the 8px these sat at read as a third divider
          rather than as the gap between two objects. */}
      <div className="flex flex-col gap-6">
        {query.isPending && (
          <p className="text-sm text-muted-foreground">Loading turfs&hellip;</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load this campaign&apos;s turfs.
          </p>
        )}
        {turfs.map((turf) => (
          <TurfRow
            key={turf.id}
            isServe={isServe}
            turf={turf}
            outreachId={outreachId}
            onOverlayOpenChange={onOverlayOpenChange}
            onTurfCompleted={onTurfCompleted}
          />
        ))}
      </div>
    </DetailsSection>
  )
}

interface TurfRowProps {
  // Which product's event names this row's lifecycle writes report under.
  isServe: boolean
  turf: DoorKnockingTurf
  outreachId: number
  onOverlayOpenChange?: (open: boolean) => void
  onTurfCompleted?: (turfId: number) => void
}

// `Continue knocking` on a per-turf row deep-links into that turf's walk,
// carrying `outreachId=<anchor>` so closing the walk reopens THIS drawer —
// the same handoff the drawer's own "Continue knocking" footer uses on the
// single-turf branch above.
const TurfRow = ({
  isServe,
  turf,
  outreachId,
  onOverlayOpenChange,
  onTurfCompleted,
}: TurfRowProps) => {
  const walkHref = `/dashboard/door-knocking?walkTurfId=${turf.id}&outreachId=${outreachId}`
  // Two labels, keyed on whether the turf has a route rather than on
  // whether anybody has knocked yet. `routeSeconds` is the field that says
  // which — null means no route, deliberately, rather than a second boolean
  // that could disagree with it.
  //
  // An unrouted press does something the other does not: it plans the route
  // and asks walking or driving on the way, so it reads as starting the
  // work. Once the route exists the press is the same press whether or not
  // a door has been logged, so it reads the same.
  const knockLabel =
    turf.routeSeconds === null ? UNROUTED_LABEL : CONTINUE_LABELS.doorKnocking
  return (
    <TurfSummaryRow
      isServe={isServe}
      turf={turf}
      onOverlayOpenChange={onOverlayOpenChange}
      onTurfCompleted={onTurfCompleted}
      action={
        <Button asChild size="small">
          <Link href={walkHref}>{knockLabel}</Link>
        </Button>
      }
    />
  )
}
