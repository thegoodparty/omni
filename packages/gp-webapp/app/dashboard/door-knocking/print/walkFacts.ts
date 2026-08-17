import type {
  DoorKnockingRoutePayload,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { formatDistance } from '../native/routeFormat'
import { countDoors, knockableTargets } from '../routeCounts'

export const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

// Age and party are the two things a canvasser uses to open a conversation,
// and they're the only enrichment worth the ink.
export const describeTarget = (target: RoutePayloadTarget): string =>
  [
    target.age === null ? null : `${target.age}`,
    target.politicalParty,
    target.mayHaveMoved ? 'may have moved' : null,
  ]
    .filter(Boolean)
    .join(' · ')

// The one sentence that states what the walk costs. The printed sheet's header
// and the downloadable PDF's subtitle are the same string from here, on top of
// the same `routeCounts` definitions the app uses — three surfaces quoting a
// route back to the same canvasser cannot afford to disagree about how many
// doors are in it, and they have before.
export const walkSummary = (
  stops: DoorKnockingRoutePayload['stops'],
  route: DoorKnockingRoutePayload['route'],
): string =>
  [
    `${stops.length} stops`,
    `${countDoors(stops)} doors`,
    `${knockableTargets(stops).length} people`,
    `${route.mode === 'walk' ? 'Walking' : 'Driving'}${route.loop ? ' loop' : ''}`,
    formatDuration(route.totalSeconds),
    formatDistance(route.totalMeters),
  ].join(' · ')
