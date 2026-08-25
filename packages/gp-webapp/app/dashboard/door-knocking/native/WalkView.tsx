'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingRoutePayload,
  DoorKnockStatus,
  NotAVoterReason,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { ChevronDownIcon, ChevronRightIcon, cn, UsersIcon } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import { countDoors, isKnockable, knockableTargets } from '../routeCounts'
import PersonSheet from './PersonSheet'
import {
  DoorNoteList,
  editServedNotes,
  withCreatedNote,
  withDeletedNote,
  withUpdatedNote,
} from './doorNotes'
import { formatDistance } from './routeFormat'
import { routeQueryOptions } from './turfQueries'
import {
  readableInkOn,
  rollupStopStatus,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  STATUS_RGB,
  stopIsKnockable,
  targetMarker,
} from './statusPresentation'

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// The numeral sits ON the stop's status color, so it has to invert with it the
// way the map's pin numerals do — white on `not_home` yellow is a number nobody
// can read at arm's length in daylight. The rule is `readableInkOn`
// (`statusPresentation.ts`), shared with the tick inside a selected list-colour
// swatch, and every one of the seven statuses clears 4.8:1 under it.
export const stopNumeralColor = (status: DoorKnockStatus): string =>
  readableInkOn(STATUS_RGB[status])

interface WalkViewProps {
  turfId: number
  // Lets the page refetch the voter pack after the walk: the landing map's
  // statuses are baked into the cached pack, so new knocks are invisible
  // there until it reloads.
  onKnockRecorded?: () => void
  // A stop the canvasser tapped on the map. The page owns the map, this view
  // owns which door is open, so the tap arrives as a request rather than as
  // state — and `token` is what makes tapping the same pin again reopen the
  // sheet that was just closed.
  openStopRequest?: { stopId: number; token: number } | null
  // The marked stop, held by the page because the map draws it too (see
  // `useWalkMapSession`). This view is still what decides where the mark goes —
  // it reports every stop it opens through `onSelectStop` — but it reads the
  // value back rather than keeping a second copy, so the ringed pin and the
  // marked row are one fact and cannot drift.
  selectedStopId: number | null
  onSelectStop: (stopId: number) => void
}

export default function WalkView({
  turfId,
  onKnockRecorded,
  openStopRequest,
  selectedStopId,
  onSelectStop,
}: WalkViewProps) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery(routeQueryOptions(turfId))
  // Recorded statuses patch the route query cache itself (not component
  // state), so they survive leaving and re-opening the walk view within the
  // cache window; a real refetch replaces them with the server's derivation.
  const patchPerson = (
    personId: string,
    patch: (target: RoutePayloadTarget) => RoutePayloadTarget,
  ) => {
    // A serve already in flight was built before this patch and would
    // overwrite it on arrival, putting a logged door back to unknown — so it
    // is cancelled first, the standard order for an optimistic write. A
    // cancelled query keeps its data and reports no error, so nothing about
    // this reaches the canvasser.
    void queryClient.cancelQueries({
      queryKey: ['door-knocking-route', turfId],
    })
    queryClient.setQueryData<DoorKnockingRoutePayload>(
      ['door-knocking-route', turfId],
      (old) =>
        old && {
          ...old,
          stops: old.stops.map((stop) => ({
            ...stop,
            addresses: stop.addresses.map((address) => ({
              ...address,
              targets: address.targets.map((target) =>
                target.personId === personId ? patch(target) : target,
              ),
            })),
          })),
        },
    )
  }
  const applyKnockStatus = (personId: string, knockStatus: DoorKnockStatus) =>
    patchPerson(personId, (target) => ({ ...target, knockStatus }))
  // ADR 0007. Same cache patch as a knock, so the marker sticks while the
  // canvasser moves down the list; the server is the truth on refetch.
  const applyDoNotKnock = (personId: string, doNotKnock: boolean) =>
    patchPerson(personId, (target) => ({ ...target, doNotKnock }))
  // ADR 0008. `cleared` arrives from the server as an absent reason, which is
  // how the route payload spells it too — so undoing a flag patches the same
  // key back to nothing rather than needing a second notion of "not flagged".
  const applyNotAVoter = (
    personId: string,
    notAVoterReason: NotAVoterReason | undefined,
  ) => patchPerson(personId, (target) => ({ ...target, notAVoterReason }))
  // ADR 0011. A note written at a door is the same kind of fact as a knock:
  // recorded by this walk, and absent from the payload the walk was served
  // with. So it takes the same road, into the cached payload the sheet reads —
  // which makes the cache the door's ONE copy of a resident's notes, with
  // nothing beside it that could disagree. Held instead in state above the card
  // it would die with the sheet, and a note written on a door that was then
  // closed without being logged would read as gone when that door was reopened:
  // `openSheet`'s ADR 0009 refresh only fires for a resident logged this
  // session, so nothing would go and ask for it either.
  //
  // Two properties come free with `patchPerson` and are the reason to reuse it
  // rather than write a second patcher. It cancels the route query first, so a
  // serve built before the note was saved cannot land after it and take the
  // note back off the card — the same race that would otherwise put a logged
  // door back to unknown. And a serve that genuinely arrives later *does*
  // replace this, which is what a note a teammate wrote needs in order to ever
  // show up here; a client-held list would shadow the server's for the rest of
  // the walk.
  const patchNotes = (
    personId: string,
    edit: (list: DoorNoteList) => DoorNoteList,
  ) =>
    patchPerson(personId, (target) => ({
      ...target,
      notes: editServedNotes(target.notes, edit),
    }))
  const [openStopId, setOpenStopId] = useState<number | null>(null)
  const stopRowRefs = useRef(new Map<number, HTMLLIElement | null>())
  const [sheet, setSheet] = useState<{
    stopId: number
    targetId: number
  } | null>(null)
  // ADR 0009. A resident's activity feed rides the route payload, so a door
  // logged during the walk is missing from that resident's own feed until the
  // next serve — while the status it produced updates everywhere else in the
  // panel, which makes the feed read as broken rather than as stale. The row
  // is the server's to build (its id, its outcome, its wording), so the fix is
  // to ask for it, never to assemble a second one here from the rollup.
  //
  // Whose feed the served payload predates. Refetching after every door would
  // put a serve-sized request at every doorstep, on the one connection this
  // feature exists to work without; asking for it when a resident logged this
  // session is opened *again* pays it only where the staleness is on screen. A
  // straight walk down the list never advances onto a logged door, so it never
  // pays it at all, and the canvasser checking "did that save?" pays once.
  const [loggedPersonIds, setLoggedPersonIds] = useState<Set<string>>(new Set())
  const targetForId = (targetId: number): RoutePayloadTarget | undefined =>
    routeQuery.data?.stops
      .flatMap((stop) => stop.addresses.flatMap((address) => address.targets))
      .find((target) => target.stopTargetId === targetId)
  const refreshFeedForPerson = (personId: string | undefined) => {
    if (!personId || !loggedPersonIds.has(personId)) return
    // Never awaited and never surfaced: the knock is already saved, so a serve
    // this walk cannot reach has to leave the feed showing what it was served
    // with rather than turn a successful door into a visible failure. Nothing
    // is tracked as "refreshed" either — a reopen after a failed serve simply
    // asks again. `cancelRefetch: false` so flicking between two logged
    // housemates reuses the serve in flight instead of restarting it.
    void routeQuery.refetch({ cancelRefetch: false })
  }
  const refreshFeedFor = (targetId: number) =>
    refreshFeedForPerson(targetForId(targetId)?.personId)
  // ADR 0009's one documented residual, and the reason it was left as one: a
  // `not_a_voter` door deliberately keeps its sheet open so the ADR 0008
  // follow-up can be answered, so neither trigger above ever fires for that
  // resident. Refreshing on the knock is what the ADR ruled out — the serve
  // rebuilds `NotAVoterControl`, whose two branches switch on
  // `notAVoterReason`, underneath the question being answered.
  //
  // So the refresh is deferred rather than dropped: it goes out once the
  // follow-up is resolved. Answering it is handled where the answer lands; this
  // is the other resolution, walking away from the question unanswered. The
  // sheet is already unmounting, so there is nothing left for the serve to
  // arrive under. Narrow on purpose — every other outcome auto-advances and is
  // covered by `openSheet`, and refreshing on every sheet close would be the
  // per-door serve ADR 0009 rejected. A reason already given takes this branch
  // out, because that path asked for its own serve.
  const refreshFeedOnAbandonedFollowUp = (targetId: number) => {
    const target = targetForId(targetId)
    if (target?.knockStatus !== 'not_a_voter' || target.notAVoterReason) return
    refreshFeedForPerson(target.personId)
  }
  // One replay key per target, minted when its form first opens and kept
  // across close→reopen (a remounted form must retry with the SAME key or
  // the server-side upsert can't dedupe). Cleared on success so a later,
  // genuinely new knock gets a fresh key instead of overwriting history.
  const [clientKeys, setClientKeys] = useState<Map<number, string>>(new Map())
  // Keys mint in the open handler (never during render — a discarded
  // concurrent render would mint throwaway UUIDs and break replay).
  const openSheet = (stopId: number, targetIds: number[], targetId: number) => {
    setClientKeys((current) => {
      const missing = targetIds.filter((id) => !current.has(id))
      if (missing.length === 0) return current
      const next = new Map(current)
      for (const id of missing) next.set(id, crypto.randomUUID())
      return next
    })
    setSheet({ stopId, targetId })
    // The one place the mark moves. A row tap, a pin tap and auto-advance all
    // arrive here, so the marked stop is always the door the sheet is
    // offering rather than a history of taps — and the map is ringing the same
    // stop for the same reason, off the same report.
    onSelectStop(stopId)
    refreshFeedFor(targetId)
  }
  const clientKeyFor = (targetId: number): string =>
    clientKeys.get(targetId) ?? ''

  const stops = useMemo(
    () => (routeQuery.data?.stops ?? []).slice().sort((a, b) => a.seq - b.seq),
    [routeQuery.data],
  )
  // Progress is over knockable doors only (see routeCounts). A flagged door
  // would otherwise sit under the `unknown` chip as outstanding work; its
  // recorded history, if any, still lives in the CRM.
  const targetCount = (stopList: RoutePayloadStop[]) =>
    knockableTargets(stopList).length
  // "Logged", not "reached": `not_home`, `inaccessible` and `refused` all
  // satisfy this predicate, so a canvasser who knocked forty doors and spoke to
  // nobody would read "40/40 reached" — a claim about conversations that never
  // happened. What the bar actually measures is doors with an answer written
  // down, which is the thing a canvasser is working through.
  const loggedCount = (stopList: RoutePayloadStop[]) =>
    knockableTargets(stopList).filter(
      (target) => target.knockStatus !== 'unknown',
    ).length
  const statusCount = (stopList: RoutePayloadStop[], status: DoorKnockStatus) =>
    knockableTargets(stopList).filter((target) => target.knockStatus === status)
      .length
  const stopStatus = rollupStopStatus
  const primaryTargetName = (stop: RoutePayloadStop): string | null =>
    stop.addresses[0]?.targets[0]?.name ?? null
  const targetsForStop = (stop: RoutePayloadStop): RoutePayloadTarget[] =>
    stop.addresses.flatMap((address) => address.targets)
  const stopKnockable = (stop: RoutePayloadStop): RoutePayloadTarget[] =>
    targetsForStop(stop).filter(isKnockable)
  // Distinct markers only: three deceased residents at one stop is one thing to
  // read, not three.
  const stopMarkers = (stop: RoutePayloadStop): string[] => [
    ...new Set(
      targetsForStop(stop)
        .map(targetMarker)
        .filter((marker): marker is string => marker !== null),
    ),
  ]

  const sheetStop = sheet
    ? (stops.find((stop) => stop.id === sheet.stopId) ?? null)
    : null
  // The doors either side of the open one, in route order — `stops` is sorted by
  // `seq`, so this is the order the walk is planned in and the order the pins are
  // numbered in. Null at the ends, which is what disables the sheet's chevron.
  const sheetStopIndex = sheetStop
    ? stops.findIndex((stop) => stop.id === sheetStop.id)
    : -1
  const previousStop =
    sheetStopIndex > 0 ? (stops[sheetStopIndex - 1] ?? null) : null
  const nextStop =
    sheetStopIndex >= 0 ? (stops[sheetStopIndex + 1] ?? null) : null

  // Every target in walk order, flattened: the unit the canvasser actually
  // moves through is a person at a door, not a stop.
  const walkOrder = useMemo(
    () =>
      stops.flatMap((stop) =>
        stop.addresses.flatMap((address) =>
          address.targets.map((target) => ({ stop, target })),
        ),
      ),
    [stops],
  )

  // "Always show the next door so there is no thinking between houses."
  // Forward only: jumping backward to a door the canvasser walked past would
  // send them back up the street, so anything skipped is left for the list.
  const advanceFrom = (loggedTargetId: number) => {
    const position = walkOrder.findIndex(
      (entry) => entry.target.stopTargetId === loggedTargetId,
    )
    const next = walkOrder.slice(position + 1).find(
      ({ target }) =>
        // This closure still sees the pre-patch cache, so the just-logged
        // target reads as unknown — excluded by id rather than by status.
        target.stopTargetId !== loggedTargetId &&
        target.knockStatus === 'unknown' &&
        isKnockable(target),
    )
    if (!next) {
      setSheet(null)
      return
    }
    openSheet(
      next.stop.id,
      targetsForStop(next.stop).map((t) => t.stopTargetId),
      next.target.stopTargetId,
    )
  }

  // A map pin tap opens the same `PersonSheet` a stop row opens, through the
  // same `openSheet` — the pin is a way INTO the door-logging surface, never a
  // second one, so replay keys and the ADR 0009 feed refresh come along with it.
  //
  // It goes straight to the sheet even for a multi-resident stop, where the row
  // expands instead: the row's list is right under the finger that pressed it,
  // while a pin is on a map band the list is scrolled away from, and the sheet's
  // own resident switcher is the same picker one step further in.
  //
  // Whom it opens is the first resident still worth knocking, so a household
  // with one flagged member lands on the person there is a conversation to have
  // with. A hollow pin — `stopIsKnockable` false, nobody left — falls through to
  // the first resident, deliberately: a tap that does nothing is the bug being
  // fixed, and a sheet is not a form. `PersonSheet` withholds the script and
  // `RecordKnockForm` for a flagged resident and renders the flag's own control
  // and its `STATUS_CHANGE` row instead, so the tap answers "why am I being told
  // to skip this house?" at the doorstep — the only place a flag set on the
  // wrong resident gets caught — without offering a knock to log.
  //
  // It also brings the list to the tapped stop. The map band and the list are
  // stacked, so the row for the pin under the thumb is usually scrolled off
  // screen: without this, closing the sheet returns the canvasser to a list
  // showing some other part of the street, and the numbered pin has no numbered
  // row to match. `openSheet` selects; this is the half only a map tap needs.
  const openStopFromMap = (stop: RoutePayloadStop) => {
    const stopTargets = targetsForStop(stop)
    const target = stopTargets.find(isKnockable) ?? stopTargets[0]
    if (!target) return
    openSheet(
      stop.id,
      stopTargets.map((t) => t.stopTargetId),
      target.stopTargetId,
    )
    stopRowRefs.current.get(stop.id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }
  // Held in a ref because the effect below has to re-run on `stops` — a request
  // that arrives before the serve does retries when it lands — while an
  // ordinary dependency on this function would re-run it on every render.
  const openStopFromMapRef = useRef(openStopFromMap)
  openStopFromMapRef.current = openStopFromMap
  // The token this view has already acted on. Every knock patches the route
  // cache and so rebuilds `stops`; without this the effect would reopen the
  // sheet on each one, under a canvasser who had closed it.
  const handledPinTapRef = useRef(0)
  const requestToken = openStopRequest?.token ?? 0
  const requestStopId = openStopRequest?.stopId ?? null
  useEffect(() => {
    if (requestToken === 0 || requestStopId === null) return
    if (handledPinTapRef.current === requestToken) return
    const stop = stops.find((candidate) => candidate.id === requestStopId)
    if (!stop) return
    handledPinTapRef.current = requestToken
    openStopFromMapRef.current(stop)
  }, [requestToken, requestStopId, stops])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4">
      {routeQuery.isPending && (
        <div className="flex h-full items-center justify-center">
          <LoadingAnimation />
        </div>
      )}
      {/* Only when there is no route to walk. A background serve that fails —
          the feed refresh below, or a window-focus refetch — leaves the walk
          fully usable on the payload already in cache, and announcing it
          beside a door that saved fine reads as the knock having failed. */}
      {routeQuery.isError && !routeQuery.data && (
        <p className="text-sm text-destructive">
          The route could not load. Refresh to try again.
        </p>
      )}
      {routeQuery.data && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div className="flex items-center justify-end gap-2 text-xs">
            {/* The offline story for v1: a canvasser walking out of signal
                takes paper. A plain link to a server-rendered page, so it
                opens and prints without this bundle. */}
            <a
              href={`/dashboard/door-knocking/print/${turfId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-3 py-1.5 font-medium underline-offset-2 hover:bg-muted/50 hover:underline"
            >
              Print list
            </a>
            <span className="rounded-full border border-border px-3 py-1.5 font-medium">
              {routeQuery.data.route.mode === 'walk' ? 'Walking' : 'Driving'}
            </span>
            {routeQuery.data.route.loop && (
              <span className="rounded-full border border-border px-3 py-1.5 font-medium">
                Loop
              </span>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">
                In this list
              </span>
              <span className="rounded-full bg-tertiary-dark px-3 py-1 text-xs font-semibold tabular-nums text-tertiary-foreground">
                {`${loggedCount(routeQuery.data.stops)}/${targetCount(
                  routeQuery.data.stops,
                )} logged`}
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-info"
                style={{
                  width: `${
                    targetCount(routeQuery.data.stops) > 0
                      ? Math.round(
                          (loggedCount(routeQuery.data.stops) /
                            targetCount(routeQuery.data.stops)) *
                            100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {DOOR_KNOCK_STATUSES.map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
                  />
                  {STATUS_LABELS[status]}{' '}
                  <span className="tabular-nums">
                    {statusCount(routeQuery.data?.stops ?? [], status)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Stops</h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {routeQuery.data.route.stopCount} stops ·{' '}
                {countDoors(routeQuery.data.stops)} doors ·{' '}
                {/* "travel", because that is all Geoapify measures: the jobs
                    we send it carry no per-stop duration, so this is the
                    movement between doors with zero time spent AT them. Bare,
                    in a row of route facts, it read as the cost of the outing
                    and undersold it by more than half. The per-leg number
                    below already names its mode for the same reason. */}
                {formatDuration(routeQuery.data.route.totalSeconds)} travel ·{' '}
                {formatDistance(routeQuery.data.route.totalMeters)}
              </span>
            </div>
            <ol className="divide-y divide-border">
              {stops.map((stop) => (
                <li
                  key={stop.id}
                  ref={(element) => {
                    stopRowRefs.current.set(stop.id, element)
                  }}
                >
                  <button
                    type="button"
                    aria-current={selectedStopId === stop.id || undefined}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      selectedStopId === stop.id
                        ? 'bg-primary/10'
                        : 'hover:bg-muted/50',
                    )}
                    onClick={() => {
                      onSelectStop(stop.id)
                      // One resident: straight to their sheet. Several:
                      // expand so the canvasser picks (the demo's behavior).
                      const stopTargets = targetsForStop(stop)
                      if (stopTargets.length === 1 && stopTargets[0]) {
                        openSheet(
                          stop.id,
                          stopTargets.map((t) => t.stopTargetId),
                          stopTargets[0].stopTargetId,
                        )
                        return
                      }
                      setOpenStopId(openStopId === stop.id ? null : stop.id)
                    }}
                  >
                    {/* One circle carrying both of the stop's facts: the
                        rolled-up status as the fill, and `seq` — the route's
                        own order, the numeral the map's pin layer draws and the
                        printed sheet prints — as the digit on it. The three
                        surfaces have to name a stop the same way for a pin to
                        be findable in the list at all, which is what the
                        numbering is for; an index would drift from `seq` the
                        moment anything but the whole route is listed. Selection
                        is a ring rather than a fill, so it cannot take the
                        status color's place — and the map's own pin is ringed
                        the same way, off the same `selectedStopId`, so the two
                        marks are one fact drawn twice. */}
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                        selectedStopId === stop.id && 'ring-2 ring-primary',
                      )}
                      style={{
                        backgroundColor: STATUS_DOT_COLORS[stopStatus(stop)],
                        color: stopNumeralColor(stopStatus(stop)),
                      }}
                    >
                      {/* A numeral in a circle at the head of a row reads as a
                          position on screen and as a bare digit to a screen
                          reader, which has none of that layout. */}
                      <span className="sr-only">Stop </span>
                      {stop.seq}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {primaryTargetName(stop) ?? stop.displayAddress}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {stop.displayAddress}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {/* ADR 0007 and 0008. The count is knockable people,
                            like every other people figure (routeCounts), and a
                            flagged resident knocked before the flag was set
                            still carries a status whose dot would sit next to a
                            marker saying the opposite. A stop with nobody left
                            says so outright rather than reading as an empty
                            house — its rollup color is the same grey as
                            still-to-knock, and the marker is the only thing
                            that tells those two apart. */}
                        {!stopIsKnockable(stop) ? (
                          <span className="font-medium text-warning">
                            Nobody to knock here
                          </span>
                        ) : (
                          <>
                            {/* The canvas puts a person glyph in front of this
                                count (`icon('users',14), householdCount(v)`).
                                Ours was a bare numeral sitting one gap away
                                from the stop's own numeral in its circle, so
                                "3" beside "12" named neither quantity — and to
                                a screen reader the row read "Stop 12, 3". The
                                glyph is the visual half and the sr-only noun
                                the spoken one; the dots after it are per-person
                                status, decorative here because the expanded row
                                labels each one. */}
                            <UsersIcon
                              size={12}
                              aria-hidden="true"
                              className="shrink-0"
                            />
                            <span className="tabular-nums">
                              {stopKnockable(stop).length}
                              <span className="sr-only">
                                {stopKnockable(stop).length === 1
                                  ? ' person to knock'
                                  : ' people to knock'}
                              </span>
                            </span>
                            {stopKnockable(stop).map((target) => (
                              <span
                                key={target.stopTargetId}
                                className="h-1.5 w-1.5 rounded-full"
                                style={{
                                  backgroundColor:
                                    STATUS_DOT_COLORS[target.knockStatus],
                                }}
                              />
                            ))}
                          </>
                        )}
                        {/* On the collapsed row, because a single-resident stop
                            opens the sheet instead of expanding — without this,
                            the common case shows an ordinary dot and the
                            canvasser walks up to the door. Distinct markers
                            only: three deceased residents is one thing to
                            read. */}
                        {stopMarkers(stop).map((marker) => (
                          <span
                            key={marker}
                            className="font-medium text-warning"
                          >
                            {marker}
                          </span>
                        ))}
                      </span>
                    </span>
                    {stop.legSeconds > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDuration(stop.legSeconds)}{' '}
                        {routeQuery.data.route.mode === 'walk'
                          ? 'walk'
                          : 'drive'}
                      </span>
                    )}
                    {targetsForStop(stop).length > 1 &&
                    openStopId === stop.id ? (
                      <ChevronDownIcon size={16} className="shrink-0" />
                    ) : (
                      <ChevronRightIcon size={16} className="shrink-0" />
                    )}
                  </button>
                  {openStopId === stop.id && (
                    <div className="flex flex-col border-t border-border bg-muted/30">
                      {targetsForStop(stop).map((target) => (
                        <button
                          key={target.stopTargetId}
                          type="button"
                          className="flex items-center gap-2 px-4 py-2.5 pl-14 text-left text-sm hover:bg-muted/60"
                          onClick={() =>
                            openSheet(
                              stop.id,
                              targetsForStop(stop).map((t) => t.stopTargetId),
                              target.stopTargetId,
                            )
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {target.name ?? 'Name unavailable'}
                          </span>
                          {/* ADR 0007 and 0008. Read before walking up, not
                              after opening the sheet, so the marker replaces
                              the knock status rather than sitting beside it. */}
                          {targetMarker(target) ? (
                            <span className="shrink-0 text-xs font-medium text-warning">
                              {targetMarker(target)}
                            </span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor:
                                    STATUS_DOT_COLORS[target.knockStatus],
                                }}
                              />
                              {STATUS_LABELS[target.knockStatus]}
                            </span>
                          )}
                          <ChevronRightIcon size={14} className="shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {sheetStop && sheet && (
        <PersonSheet
          stop={sheetStop}
          stopSeq={sheetStop.seq}
          // Both go through `openStopFromMap`, which is the one entry that also
          // brings the list to the stop it opens — without it the canvasser
          // walks four doors from the sheet and closes it onto a list still
          // showing where they started. It picks the first resident still worth
          // knocking, the same choice a pin tap makes.
          onOpenPreviousStop={
            previousStop ? () => openStopFromMap(previousStop) : null
          }
          onOpenNextStop={nextStop ? () => openStopFromMap(nextStop) : null}
          selectedTargetId={sheet.targetId}
          onSelectTarget={(targetId) => {
            setSheet({ stopId: sheet.stopId, targetId })
            // The other way back to a resident already logged: the switcher
            // inside the sheet, which never goes through openSheet.
            refreshFeedFor(targetId)
          }}
          statusFor={(target) => target.knockStatus}
          clientKeyFor={clientKeyFor}
          onRecorded={(targetId, personId, knockStatus) => {
            applyKnockStatus(personId, knockStatus)
            // ADR 0009. The served payload now predates this resident's own
            // history, so reopening them asks for a fresh one.
            setLoggedPersonIds((current) => new Set(current).add(personId))
            onKnockRecorded?.()
            setClientKeys((current) => {
              const next = new Map(current)
              next.delete(targetId)
              return next
            })
            // ADR 0008. Every other outcome walks on; this one has a follow-up
            // waiting in the sheet, and advancing would ask "what happened?"
            // and take the answer away in the same frame. The door is already
            // saved either way, so a canvasser who ignores the question and
            // taps the next stop has still logged it.
            if (knockStatus === 'not_a_voter') return
            advanceFrom(targetId)
          }}
          onNoteCreated={(personId, created) =>
            patchNotes(personId, (list) => withCreatedNote(list, created))
          }
          onNoteUpdated={(personId, updated) =>
            patchNotes(personId, (list) => withUpdatedNote(list, updated))
          }
          onNoteDeleted={(personId, noteId) =>
            patchNotes(personId, (list) => withDeletedNote(list, noteId))
          }
          onDoNotKnockChanged={applyDoNotKnock}
          onNotAVoterChanged={(personId, notAVoterReason) => {
            applyNotAVoter(personId, notAVoterReason)
            // ADR 0009's residual, closed. The question this resident's sheet
            // was held open for has just been answered, so the control a serve
            // would rebuild is already the marker that answer resolves to —
            // which is what makes the deferred refresh safe here and not on
            // the knock. After the patch, so the patch's own cancellation of
            // an older in-flight serve can't take this one with it.
            refreshFeedForPerson(personId)
          }}
          onClose={() => {
            setSheet(null)
            refreshFeedOnAbandonedFollowUp(sheet.targetId)
          }}
        />
      )}
    </div>
  )
}
