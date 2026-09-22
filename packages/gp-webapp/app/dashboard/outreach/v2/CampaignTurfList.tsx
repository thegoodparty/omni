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
import { DetailsSection } from './listDetails/ListDetailsMetric'

// The compact in-drawer sibling list for a door-knocking campaign anchor.
// One row per turf in the campaign, plus an "Add another turf" affordance
// that navigates the candidate into the create flow already scoped to this
// campaign. Deliberately NOT a full map: the drawer's 608px column would
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
  // A row's confirm dialog portals out of the drawer this section sits in, so
  // its clicks land as outside-interactions and would dismiss the sheet
  // mid-write — the bug the drawer's own two confirms already record. The row
  // reports that one is open and the drawer decides what it means, rather
  // than the drawer owning a dialog for a mutation it has no turf for.
  onConfirmOpenChange?: (open: boolean) => void
}

const percentLabel = (numerator: number, denominator: number): string => {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export const CampaignTurfList = ({
  anchorOutreachId,
  outreachId,
  onConfirmOpenChange,
}: CampaignTurfListProps) => {
  const query = useQuery(campaignTurfsQueryOptions(anchorOutreachId))
  const turfs = query.data ?? []
  const addTurfHref = `/dashboard/door-knocking?campaignOutreachId=${anchorOutreachId}&create=1`

  return (
    <DetailsSection title="Turfs in this campaign">
      <div className="flex flex-col gap-2">
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
            onConfirmOpenChange={onConfirmOpenChange}
          />
        ))}
      </div>
      <Button asChild variant="outline" className="mt-3">
        <Link href={addTurfHref}>Add another turf</Link>
      </Button>
    </DetailsSection>
  )
}

interface TurfRowProps {
  turf: DoorKnockingTurf
  outreachId: number
  onConfirmOpenChange?: (open: boolean) => void
}

// `Continue knocking` on a per-turf row deep-links into that turf's walk,
// carrying `outreachId=<anchor>` so closing the walk reopens THIS drawer —
// the same handoff the drawer's own "Continue knocking" footer uses on the
// single-turf branch above.
const TurfRow = ({ turf, outreachId, onConfirmOpenChange }: TurfRowProps) => {
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
    onConfirmOpenChange?.(open)
  }
  return (
    <Card className="gap-2 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 rounded-full ${
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
        {active ? (
          <>
            {/* The first manual `markDone` caller in the product. The row's
                second control, which is inside the four the rail's budget
                allows, so no overflow menu. Muted and left of Continue so the
                primary action keeps the right edge. */}
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
              disabled={pending}
              onClick={() => {
                // Nothing to warn about on a fully logged turf.
                if (unlogged <= 0) return lifecycle.markDone()
                openConfirm(true)
              }}
            >
              Mark done
            </button>
            <Link
              href={walkHref}
              className="shrink-0 text-sm font-medium text-primary hover:underline"
            >
              Continue
            </Link>
          </>
        ) : (
          // A label rather than a disabled link: there is nothing to press,
          // and the rail's own archived rings are dimmed rather than removed
          // for the same reason — shelved is a state, not a deletion.
          <span className="shrink-0 text-sm font-medium text-muted-foreground">
            {turfStatusLabel(turf)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {turf.peopleCount.toLocaleString()} people (
          {turf.doorCount.toLocaleString()} doors)
        </span>
        <span>
          {turf.loggedCount.toLocaleString()} of{' '}
          {turf.peopleCount.toLocaleString()} logged (
          {percentLabel(turf.loggedCount, turf.peopleCount)})
        </span>
      </div>
      <Progress value={progress} />
      <MarkDoneDialog
        target={markDoneTarget}
        onOpenChange={openConfirm}
        pending={pending}
        // Held open until the write resolves: the dialog preventDefaults for
        // us, and a failure then leaves a dialog the candidate can retry from
        // rather than a snackbar behind a sheet they stopped looking at.
        onConfirm={() =>
          lifecycle.markDone({ onSuccess: () => openConfirm(false) })
        }
      />
    </Card>
  )
}
