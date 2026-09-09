import {
  CalendarDaysIcon,
  CalendarIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import {
  composeOutreachHref,
  type ComposeFlowType,
} from 'app/dashboard/outreach/util/composeOutreachHref.util'

// Where a tracker task's CTA points, and how it's labelled. Shared by both
// Campaign Manager homes (the card stack and the conversational one) so a
// task's action can't resolve to a different place depending on which home the
// candidate is in.

// Fallback when a task has no action link of its own.
const TRACKER_HREF = '/dashboard/campaign-plan'

// A task's own action link, if it has a non-empty one. Trimmed so an empty or
// whitespace string (which the agent can emit) counts as "no link" rather than
// rendering a broken href, matching the tracker, which hides the link then.
const taskLink = (task: { link: string | null }): string | null =>
  task.link?.trim() ? task.link : null

// Text/robocall tasks link into the outreach hub with the due date bound
// (mirrors the tracker rows); everything else falls back to the tracker page.
export const composeFlowType = (task: {
  link: string | null
  flowType: string | null
}): ComposeFlowType | null => {
  if (taskLink(task)) return null
  return task.flowType === 'text' || task.flowType === 'robocall'
    ? task.flowType
    : null
}

// Each card links to the task's own action, falling back to the tracker page.
// Compose (text/robocall) tasks link into the outreach hub, which opens the
// channel's flow behind its own gate — see outreach/AGENTS.md for why a CTA
// links there instead of mounting the flow where it was pressed.
export const taskHref = (task: {
  link: string | null
  flowType: string | null
  date: string | null
}): string | undefined => {
  const own = taskLink(task)
  if (own) return own
  const composeType = composeFlowType(task)
  return composeType
    ? composeOutreachHref(composeType, 'campaign_manager', task.date)
    : TRACKER_HREF
}

// Routes that render an upgrade wall to a non-Pro Win campaign instead of a
// usable surface: door knocking's native arm (DoorKnockingProLockedView) and
// Know Your Opponent (OpponentProLockedView, server-side on all three of its
// pages). The tracker, contacts and the social channel are all open, so they
// are deliberately absent.
const PRO_WALLED_ROUTES = [
  '/dashboard/door-knocking',
  '/dashboard/race-opponent',
]

/**
 * Whether this task's CTA would dead-end a non-Pro candidate.
 *
 * Keyed on the CTA's actual destination rather than the task's `proRequired`
 * flag, because the agent-generated dynamic rows come back with
 * `proRequired: false` even for the channels the catalog marks Pro — a
 * door-knocking row arrives unflagged, so trusting the flag alone gates
 * nothing. The flag is still honored when it is set.
 *
 * text and robocall wall at the compose deep link (P2PUpgradeModal and
 * ProUpgradeModal respectively). A phoneBanking row has no compose CTA at all,
 * so it falls back to the tracker and does not wall here.
 */
export const taskLeadsToProWall = (task: {
  cta: string | null
  link: string | null
  flowType: string | null
  date: string | null
  proRequired: boolean | null
}): boolean => {
  if (task.proRequired === true) return true
  if (composeFlowType(task)) return true
  const href = taskHref(task)
  return !!href && PRO_WALLED_ROUTES.some((route) => href.startsWith(route))
}

// A task's CTA label: its own if the agent wrote one, else derived from where
// the CTA points.
export const taskCtaLabel = (task: {
  cta: string | null
  link: string | null
  flowType: string | null
}): string =>
  task.cta?.trim() ||
  (taskLink(task)
    ? 'Open'
    : composeFlowType(task)
      ? 'Start outreach'
      : 'See details')

// Eyebrow label + icon per tracker flowType (same set buildTrackerStrategy maps
// to channels). Unknown/static rows fall back to a generic priority label.
const FLOW_TYPE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  text: { label: 'Messaging', Icon: MessageSquareIcon },
  robocall: { label: 'Robocall', Icon: PhoneIcon },
  phoneBanking: { label: 'Phone banking', Icon: PhoneIcon },
  doorKnocking: { label: 'Door knocking', Icon: MapPinIcon },
  events: { label: 'Event', Icon: CalendarIcon },
  awareness: { label: 'Awareness', Icon: CalendarDaysIcon },
}
const DEFAULT_META = { label: 'Priority', Icon: SparklesIcon }

export const taskMeta = (
  flowType: string | null,
): { label: string; Icon: LucideIcon } =>
  (flowType && FLOW_TYPE_META[flowType]) || DEFAULT_META
