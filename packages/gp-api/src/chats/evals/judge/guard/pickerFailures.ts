import { z } from 'zod'

// judge-guard.yml runs on `pull_request_target`, and the judge sweep role's
// trust condition is pinned to `job_workflow_ref=judge.yml@refs/heads/main`
// with a test (judgeWorkflow.test.ts) that explicitly forbids the word
// `pull_request` anywhere in it — a `pull_request_target` workflow can never
// satisfy that, and widening the role is a security question of its own this
// story does not open (ENG-11591's resume, resolved on the ClickUp card).
// So the failure ledger lives in GitHub's own artifact store instead of S3:
// `judge-guard.yml` uploads one marker artifact under this name per picker
// failure, and lists them back through the Actions artifacts API
// (`GET /repos/{owner}/{repo}/actions/artifacts?name=...`) to count how many
// landed in the trailing 7 days — no AWS credentials anywhere in this file.
export const PICKER_FAILURE_ARTIFACT_NAME = 'judge-guard-picker-failure'

// "Don't alert more than once a day for the same streak." One of these is
// uploaded each time the alert actually posts, so the next failure can tell
// whether this streak already alerted today without keeping any state of its
// own.
export const PICKER_ALERT_ARTIFACT_NAME = 'judge-guard-picker-alert'

// The only two fields this module's window math needs, out of everything the
// Actions artifacts API returns for one entry in its `artifacts[]` list.
export const ArtifactSchema = z.object({
  created_at: z.iso.datetime(),
  expired: z.boolean(),
})
export type Artifact = z.infer<typeof ArtifactSchema>

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const countWithinWindow = (
  artifacts: readonly Artifact[],
  now: Date,
  windowMs: number,
): number => {
  const windowStart = now.getTime() - windowMs
  return artifacts.filter(
    (a) => !a.expired && new Date(a.created_at).getTime() >= windowStart,
  ).length
}

// "Alert when the picker fails twice in a week. Once is noise." (TDD "When
// the picker fails"). A trailing 7-day window ending now, not a calendar
// week, so two failures 8 days apart (test plan) never share one.
export const shouldAlert = (
  failureArtifacts: readonly Artifact[],
  now: Date,
): boolean => countWithinWindow(failureArtifacts, now, SEVEN_DAYS_MS) >= 2

// A `judge-guard-picker-alert` marker landed in the last 24 hours, so this
// failure is part of a streak that already alerted once today.
export const alertedRecently = (
  alertArtifacts: readonly Artifact[],
  now: Date,
): boolean => countWithinWindow(alertArtifacts, now, ONE_DAY_MS) >= 1
