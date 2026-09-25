'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button, Card, Progress } from '@styleguide'
import { campaignTurfsQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'
import {
  turfStage,
  turfStatusLabel,
  useTurfLifecycle,
} from 'app/dashboard/door-knocking/native/turfLifecycle'
import {
  MarkDoneDialog,
  type MarkDoneTarget,
} from 'app/dashboard/door-knocking/native/MarkDoneDialog'
import { turfCountsLabel } from 'app/dashboard/door-knocking/native/TurfRowCard'
import { TurfAssigneeMenu } from './TurfAssigneeMenu'
import { DetailsSection } from './listDetails/ListDetailsMetric'

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

const percentLabel = (numerator: number, denominator: number): string => {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export const CampaignTurfList = ({
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
  turf,
  outreachId,
  onOverlayOpenChange,
  onTurfCompleted,
}: TurfRowProps) => {
  const [markDoneTarget, setMarkDoneTarget] = useState<MarkDoneTarget | null>(
    null,
  )
  const lifecycle = useTurfLifecycle(turf)
  const walkHref = `/dashboard/door-knocking?walkTurfId=${turf.id}&outreachId=${outreachId}`
  const progress =
    turf.peopleCount > 0 ? (turf.loggedCount / turf.peopleCount) * 100 : 0
  // The campaign read is scoped on `deletedAt` only, so a shelved OR finished
  // sibling is still in this list. Neither offers Continue: an archived list
  // is one the candidate put away, and what Done takes away IS Knock (the
  // rail's rule, recorded in `walkCompletion.ts`). This used to branch on
  // archived alone, so a finished turf still deep-linked into a walk with
  // nothing left to knock. Widening it is also what makes this section a
  // legible answer to "which turfs aren't done", which is the question the
  // campaign confirm counts.
  const active = turfStage(turf) === 'active'
  const unlogged = Math.max(0, turf.peopleCount - turf.loggedCount)
  const pending = lifecycle.pendingAction === 'complete'
  const openConfirm = (open: boolean) => {
    setMarkDoneTarget(
      open ? { kind: 'turf', name: turf.name, unloggedCount: unlogged } : null,
    )
    onOverlayOpenChange?.(open)
  }
  const knockLabel =
    turf.loggedCount > 0 ? 'Continue knocking' : 'Start knocking'
  return (
    // The two-half card the drawing surface's own turf cards use: a header
    // and, under a full-bleed rule, a washed half.
    //
    // **The turf's colour is the DOT and nothing else here.** Drawing the
    // bar, the wash and the CTA in it as well was tried and is too much: a
    // list of turfs became a list of differently-coloured buttons, and the
    // one control you came for stopped looking like the same control on
    // every card. The drawing surface can afford the full treatment because
    // there is one open card at a time beside the shape it is about; a list
    // cannot. Two of the palette's seven hues also cannot carry white text,
    // so a coloured CTA needs an ink flip that the primary token never does.
    <Card className="gap-0 overflow-clip rounded-lg p-0">
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex flex-row items-center gap-3">
          <span
            aria-hidden="true"
            className={`my-auto size-3 shrink-0 rounded-full ${
              active ? '' : 'opacity-40'
            }`}
            style={{ backgroundColor: turf.color }}
          />
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${
              active ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {turf.name}
          </span>
          {/* Who walks it, as the control that changes it. On a turf nobody
              is walking any more there is nothing to hand over, so the
              status takes the slot instead — one thing in the top right,
              whichever it is. */}
          {active ? (
            <TurfAssigneeMenu
              outreachId={turf.outreachId}
              onMenuOpenChange={onOverlayOpenChange}
            />
          ) : (
            <span className="shrink-0 text-sm font-medium text-muted-foreground">
              {turfStatusLabel(turf)}
            </span>
          )}
        </div>
        <Progress value={progress} />
        {/* What the turf is worth on the left, how much of it is done on the
            right. The percentage is of PEOPLE logged, which is the
            population the left-hand figure ends with — the two have to name
            the same denominator or the number reads as a share of stops. */}
        <div className="flex flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{turfCountsLabel(turf)}</span>
          <span className="shrink-0 tabular-nums">
            {percentLabel(turf.loggedCount, turf.peopleCount)}
          </span>
        </div>
      </div>
      {/* Only while there is something to do. A done or archived turf keeps
          its figures and loses the bar, rather than offering a dead CTA. */}
      {active && (
        <div className="flex flex-row items-center gap-3 border-t bg-primary/5 px-3 py-2.5">
          {/* The first manual `markDone` caller in the product, and the
              quieter of the two: it ends the turf, so it is a text button
              beside the filled one rather than competing with it. */}
          <Button
            type="button"
            variant="ghost"
            className="shrink-0"
            disabled={pending}
            onClick={() => {
              // Nothing to warn about on a fully logged turf.
              if (unlogged <= 0) {
                return lifecycle.markDone({
                  onSuccess: () => onTurfCompleted?.(turf.id),
                })
              }
              openConfirm(true)
            }}
          >
            Mark as done
          </Button>
          {/* Hugs its label and keeps the right edge, so the two controls
              read as "the quiet one and the one you came for" rather than
              as a split bar. */}
          <Button asChild className="ml-auto w-fit">
            <Link href={walkHref}>{knockLabel}</Link>
          </Button>
        </div>
      )}
      <MarkDoneDialog
        target={markDoneTarget}
        onOpenChange={openConfirm}
        pending={pending}
        // Held open until the write resolves: the dialog preventDefaults for
        // us, and a failure then leaves a dialog the candidate can retry from
        // rather than a snackbar behind a sheet they stopped looking at.
        onConfirm={() =>
          lifecycle.markDone({
            onSuccess: () => {
              openConfirm(false)
              onTurfCompleted?.(turf.id)
            },
          })
        }
      />
    </Card>
  )
}
