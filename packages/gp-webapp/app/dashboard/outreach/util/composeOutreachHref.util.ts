// The outreach types a campaign-plan task can start.
export type ComposeFlowType = 'text' | 'robocall'

// Where the compose link was pressed. Rides the URL because the hub — not the
// linking surface — is what fires `ClickCreate` and runs the channel gate now,
// and flattening every task CTA to `deep_link` would lose the attribution the
// in-place launch used to report.
export type ComposeSource = 'campaign_manager' | 'campaign_tracker'

// A task CTA links into the hub rather than mounting a flow in place: the hub
// owns the one instance of each channel flow (and the gates in front of them),
// so a second mount would mean a second copy of both. The due date rides along
// so it can be persisted on the outreach record and forwarded into the CAS
// Slack notification.
export const composeOutreachHref = (
  type: ComposeFlowType,
  source: ComposeSource,
  due?: string | null,
): string => {
  const params = new URLSearchParams({ compose: type, source })
  // YYYY-MM-DD only — the hub re-validates, so a malformed value is dropped
  // there rather than trusted here.
  if (due) params.set('due', due.slice(0, 10))
  return `/dashboard/outreach?${params.toString()}`
}
