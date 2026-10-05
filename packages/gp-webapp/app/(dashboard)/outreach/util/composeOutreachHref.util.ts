import { CampaignStrategyPhaseKeySchema } from '@goodparty_org/contracts'
import type {
  OutreachFlowSource,
  OutreachTrackerOrigin,
} from './outreachAnalytics'

// The outreach types a campaign-plan task can start.
export type ComposeFlowType = 'text' | 'robocall'

// Where the compose link was pressed. Rides the URL because the hub — not the
// linking surface — is what fires `ClickCreate` and runs the channel gate now,
// and flattening every task CTA to `deep_link` would lose the attribution the
// in-place launch used to report.
export type ComposeSource =
  | 'campaign_manager'
  | 'campaign_tracker'
  // The voter data page's "Choose a channel" picker.
  | 'voter_data'

// The compose link's own vocabulary predates this one and stays as it is on
// `Outreach - Click Create`, so renaming it there would not split history.
// Only the flow-level events read the tracker as the campaign plan.
export const flowSourceFromCompose = (
  source: ComposeSource | undefined,
): OutreachFlowSource =>
  source === 'campaign_tracker' ? 'campaign_plan' : (source ?? 'deep_link')

// A task CTA links into the hub rather than mounting a flow in place: the hub
// owns the one instance of each channel flow (and the gates in front of them),
// so a second mount would mean a second copy of both. The due date rides along
// so it can be persisted on the outreach record and forwarded into the CAS
// Slack notification.
export const composeOutreachHref = (
  type: ComposeFlowType,
  source: ComposeSource,
  due?: string | null,
  // The tracker task this CTA was pressed on. It rides the URL for the same
  // reason `source` does — the hub fires the outreach events, and without the
  // task id travelling with the press, task completion and voter outreach stay
  // two funnels that cannot be joined.
  tracker?: OutreachTrackerOrigin,
): string => {
  const params = new URLSearchParams({ compose: type, source })
  // YYYY-MM-DD only — the hub re-validates, so a malformed value is dropped
  // there rather than trusted here.
  if (due) params.set('due', due.slice(0, 10))
  if (tracker) {
    params.set('trackerTaskId', tracker.trackerTaskId)
    params.set('phase', tracker.phase)
  }
  return `/outreach?${params.toString()}`
}

// Both halves or neither: a phase with no task id names nothing joinable, and
// a task id with no phase loses the cut the activation work is measured on.
// The phase is allowlisted against the contract rather than passed through, so
// the query string cannot inject an arbitrary value into analytics — same rule
// as `source` above.
export const parseTrackerOrigin = (
  trackerTaskId: string | null | undefined,
  phase: string | null | undefined,
): OutreachTrackerOrigin | undefined => {
  const parsedPhase = CampaignStrategyPhaseKeySchema.safeParse(phase)
  if (!trackerTaskId || !parsedPhase.success) return undefined
  return { trackerTaskId, phase: parsedPhase.data }
}
