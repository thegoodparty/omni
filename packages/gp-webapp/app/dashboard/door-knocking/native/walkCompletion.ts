import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { knockableTargets } from '../routeCounts'
import { routeQueryOptions } from './turfQueries'
import { canCompleteTurf, useTurfLifecycle } from './turfLifecycle'

// Leaving a walk stamps the list Done, but only once there is nothing left in
// it to knock.
//
// The unconditional version was rejected, and not narrowly. Done is the one
// rail action with no undo beside it — archive has Restore, delete has a
// confirm — and what it takes away is Knock: a Done card offers Details and
// Move to Archive instead. Leaving a walk is also the ONLY way out of one, so
// under an unconditional rule a canvasser who knocked three doors of fifty and
// stopped for the evening would come back to a list that no longer offers the
// way back in. Completing on the back button would be reading "I am done for
// now" as "this list is finished", which is exactly the sentence the button
// does not say.
//
// So the walk has to actually be finished, and "finished" is the same quantity
// the walk's own progress bar counts: every knockable person logged, per
// `routeCounts` — do-not-knock and not-a-voter residents dropped, and `logged`
// meaning an answer is written down rather than a conversation happened. That
// is the reading a canvasser has been watching climb all evening, so the list
// stamping itself Done as they leave a 40/40 walk is the outcome they already
// believe in. The card's own "Mark this list done" stays for every other case,
// which is what makes erring toward not-completing cheap: the manual control is
// one tap away, while an unwanted Done can only be undone by archiving and
// restoring.
//
// Two states that are NOT finished, deliberately:
//
//   no route in cache — a serve that never landed reports zero stops and zero
//     targets, which is indistinguishable from a list with nobody in it. Never
//     stamp a list off a fetch that failed.
//   nobody knockable — every resident flagged. Arguably finished, since no
//     walk can move it, but the fixed point of the rule above is that a Done
//     nobody asked for costs more than a Done nobody got, and this is the one
//     case where a canvasser walked past every door without logging anything.
//
// The write itself is `useTurfLifecycle`'s. It is idempotent server-side and
// mirrors `status: completed` onto the outreach envelope inside gp-api's own
// transaction, and it invalidates the rail before its snackbar fires — so the
// candidate lands back on a map whose card already reads Done.
export const useWalkCompletion = (turf: DoorKnockingTurf | null) => {
  // The turf the mutation was started against has to outlive the walk by a
  // beat. `useTurfLifecycle` reads its turf out of the render it was called in,
  // and a mutation observer pushes each new render's options onto the request
  // already in flight — so the walk closing in the same handler that starts the
  // write swapped the id out from under it, and the POST went to the standin
  // below. Held in a ref rather than fixed at the call site because the page
  // has every reason to clear the walk immediately; this is the hook's problem.
  const startedAgainst = useRef<DoorKnockingTurf | null>(null)
  if (turf) startedAgainst.current = turf
  const lifecycle = useTurfLifecycle(startedAgainst.current ?? NO_WALK_TURF)
  const routeQuery = useQuery({
    // The same key the walk's map session and `WalkView` read, so this asks for
    // nothing of its own — it reads the payload the walk was already running
    // on, including the optimistic patches each logged door writes into it.
    ...routeQueryOptions(turf?.id ?? 0),
    enabled: turf !== null,
  })

  return () => {
    if (!turf || !canCompleteTurf(turf)) return
    const targets = knockableTargets(routeQuery.data?.stops ?? [])
    if (targets.length === 0) return
    if (targets.some((target) => target.knockStatus === 'unknown')) return
    lifecycle.markDone()
  }
}

// `useTurfLifecycle` takes a turf because every other caller is a rail card
// that has one; the orchestrator only has one while a walk is open, and a hook
// cannot be called conditionally. This stands in for the renders before the
// first walk of a session.
//
// Nothing can be written against it. The returned callback returns on a null
// `turf` before it reaches the mutation, and `canCompleteTurf` is false here
// anyway — `locked: false`, which is the same gate that keeps the rail from
// offering Done on a list with no route.
const NO_WALK_TURF: DoorKnockingTurf = {
  id: 0,
  voterFileFilterId: 0,
  name: '',
  color: '#000000',
  geoPoly: { type: 'Polygon', coordinates: [] },
  locked: false,
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
