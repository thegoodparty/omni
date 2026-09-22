import { OutreachStatus, OutreachType } from '../../generated/prisma'

// A door-knocking campaign is many turfs under one Outreach anchor: the
// anchor has `campaignOutreachId = null` and its siblings all carry that
// anchor's id. History surfaces read the campaign, never a sibling, so the
// list query collapses siblings into their anchor and attaches a
// `turfCount` so the row can show "N turfs" without a second read. Every
// non-door-knocking row passes through as its own campaign of one.

type DoorKnockingType =
  | typeof OutreachType.doorKnocking
  | typeof OutreachType.nativeDoorKnocking

const DOOR_KNOCKING_TYPES: readonly DoorKnockingType[] = [
  OutreachType.doorKnocking,
  OutreachType.nativeDoorKnocking,
]

type MinimalOutreach = {
  id: number
  outreachType: OutreachType
  campaignOutreachId: number | null
  createdAt: Date
  status: OutreachStatus | null
}

export type WithTurfCount<T> = T & { turfCount: number }

// Cast the array UP to the wider member type rather than the argument DOWN,
// so the narrowing is only inside `includes` and the row's `outreachType`
// stays honest at the call site.
const isDoorKnocking = (row: { outreachType: OutreachType }) =>
  (DOOR_KNOCKING_TYPES as readonly OutreachType[]).includes(row.outreachType)

export function collapseDoorKnockingCampaigns<T extends MinimalOutreach>(
  rows: T[],
): WithTurfCount<T>[] {
  const nonDk: WithTurfCount<T>[] = []
  const dkByAnchor = new Map<number, T[]>()

  for (const row of rows) {
    if (!isDoorKnocking(row)) {
      nonDk.push({ ...row, turfCount: 1 })
      continue
    }
    const anchorId = row.campaignOutreachId ?? row.id
    const bucket = dkByAnchor.get(anchorId) ?? []
    bucket.push(row)
    dkByAnchor.set(anchorId, bucket)
  }

  const dkAnchors: WithTurfCount<T>[] = []
  for (const [anchorId, siblings] of dkByAnchor) {
    // Prefer the row whose own id is the anchor id. If that row was hard-
    // deleted while siblings survived (Postgres FK is SetNull, so the
    // siblings would also be null'd — this branch is defensive), fall back
    // to the earliest-created sibling so the campaign still surfaces.
    const anchor =
      siblings.find((s) => s.id === anchorId) ??
      siblings.reduce((earliest, s) =>
        s.createdAt < earliest.createdAt ? s : earliest,
      )
    // The campaign's status, not the anchor turf's. Completion is written
    // per TURF (`complete` takes a turf id and updates one envelope), and the
    // collapse hands the anchor's row up as the campaign's — so a four-turf
    // campaign read "Done" in outreach history the moment its anchor turf was
    // finished, with three turfs unwalked.
    //
    // Safe to state as a flat rule because a door-knocking envelope's status
    // only ever moves `in_progress` -> `completed`: create writes the first,
    // `complete` writes the second, and archive and delete touch their own
    // columns instead. So "not every turf completed" is exactly
    // `in_progress`, with nothing else it could be.
    //
    // Fixed here rather than at each surface because the history table and
    // the drawer both read this row — a guard per surface is the arrangement
    // that let the badge keep lying after the counts beside it were fixed.
    const everyTurfCompleted = siblings.every(
      (s) => s.status === OutreachStatus.completed,
    )
    const status =
      !everyTurfCompleted && anchor.status === OutreachStatus.completed
        ? OutreachStatus.in_progress
        : anchor.status
    dkAnchors.push({ ...anchor, status, turfCount: siblings.length })
  }

  return [...nonDk, ...dkAnchors]
}
