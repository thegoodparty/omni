'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button, Card, Progress } from '@styleguide'
import { campaignTurfsQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'
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
}

const percentLabel = (numerator: number, denominator: number): string => {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export const CampaignTurfList = ({
  anchorOutreachId,
  outreachId,
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
          <TurfRow key={turf.id} turf={turf} outreachId={outreachId} />
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
}

// `Continue knocking` on a per-turf row deep-links into that turf's walk,
// carrying `outreachId=<anchor>` so closing the walk reopens THIS drawer —
// the same handoff the drawer's own "Continue knocking" footer uses on the
// single-turf branch above.
const TurfRow = ({ turf, outreachId }: TurfRowProps) => {
  const walkHref = `/dashboard/door-knocking?walkTurfId=${turf.id}&outreachId=${outreachId}`
  const progress =
    turf.peopleCount > 0 ? (turf.loggedCount / turf.peopleCount) * 100 : 0
  return (
    <Card className="gap-2 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: turf.color }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {turf.name}
        </span>
        <Link
          href={walkHref}
          className="text-sm font-medium text-primary hover:underline"
        >
          Continue
        </Link>
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
    </Card>
  )
}
