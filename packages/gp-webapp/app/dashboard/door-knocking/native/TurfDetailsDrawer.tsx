'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { polygonStats } from './filterEngine'
import type { DecodedPack } from './packDecoder'
import { savedListsQueryOptions } from './turfQueries'
import { savedListFilterKeys } from './savedListFilters'
import {
  filtersToDimSelections,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import TurfDetailsSheet from './TurfDetailsSheet'

// SEAM — the details drawer (Wave 1B).
//
// This surface owns: everything the drawer says about ONE list. That includes
// resolving the list's saved filters and running the pre-route counts off
// them, which used to sit in the orchestrator and is read by nothing else —
// `polygonStats` with the list's OWN filters, so Details reproduces the number
// the list was committed against rather than everyone inside its ring.
//
// The orchestrator owns: which turf is open (`turf`), the pack (because the
// map decodes it and gates it on a resolvable district), and its own
// references to a turf this drawer can delete. It hands the pack down rather
// than letting this surface subscribe, so a district with no pack cannot be
// made to fetch one by opening a drawer.
//
// The canvas moves this to an overview-only drawer shared with the outreach
// history table. Keep the prop surface this narrow: a drawer that reaches for
// door-knocking orchestrator state cannot be mounted from that table.
export interface TurfDetailsDrawerProps {
  turf: DoorKnockingTurf
  // Null while the pack is decoding, failed, or gated off. Never a reason to
  // print a count: an absent pack is not an empty polygon.
  pack: DecodedPack | null
  // "The pack can still arrive" — a different claim from "the pack answered
  // nothing", and the drawer renders a skeleton for one and Unavailable for
  // the other. Named by the orchestrator so the rail and this drawer cannot
  // answer that question differently.
  packPending: boolean
  onClose: () => void
  // The orchestrator holds its own references to this turf (map scope, camera
  // focus), which would otherwise keep masking the map to a list that no
  // longer exists.
  onDeleted: (turf: DoorKnockingTurf) => void
}

export default function TurfDetailsDrawer({
  turf,
  pack,
  packPending,
  onClose,
  onDeleted,
}: TurfDetailsDrawerProps) {
  const savedListsQuery = useQuery(savedListsQueryOptions)
  // The list carrying this turf's filters, which can be missing for three
  // unrelated reasons — still loading, the request failed, or it was deleted
  // in the CRM. None of them means "no filters", but
  // `savedListFilterKeys(undefined)` is `{}`, which `polygonStats` reads as
  // exactly that and answers with every door in the ring. Resolving it here
  // makes all three produce no stats rather than an unfiltered count.
  const list = useMemo(
    () =>
      savedListsQuery.data?.find(
        (candidate) => candidate.id === turf.voterFileFilterId,
      ),
    [savedListsQuery.data, turf.voterFileFilterId],
  )
  // The pre-route stats: doors/voters inside the saved polygon that the list's
  // OWN filters keep. This is the same computation the draw step ran on the
  // same shape, so Details reproduces the number the list was saved against.
  const listStats = useMemo(
    () =>
      pack && list
        ? polygonStats(
            pack,
            filtersToDimSelections(savedListFilterKeys(list), pack.manifest),
            (turf.geoPoly.coordinates[0] ?? []) as [number, number][],
          )
        : null,
    [pack, turf, list],
  )
  // The same unshadeable selections the draw step discloses, for the SAVED
  // list rather than for a draft: the create flow's `unpreviewableKeys`
  // describes whatever is being drawn right now, which is nothing at all while
  // this drawer is open.
  const unpreviewableKeys = useMemo(
    () =>
      pack && list
        ? unpreviewableFilterKeys(savedListFilterKeys(list), pack.manifest)
        : [],
    [pack, list],
  )

  return (
    <TurfDetailsSheet
      turf={turf}
      listStats={listStats}
      // Both inputs, since either one still in flight leaves the stats null
      // for a reason that resolves itself. A settled null is a different
      // claim, and the sheet makes it rather than printing 0.
      listStatsPending={packPending || savedListsQuery.isPending}
      unpreviewableKeys={unpreviewableKeys}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  )
}
