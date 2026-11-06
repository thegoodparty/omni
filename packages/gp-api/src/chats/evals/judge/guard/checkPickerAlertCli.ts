import { appendFileSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  alertedRecently,
  ArtifactSchema,
  shouldAlert,
  type Artifact,
} from './pickerFailures'
import { postPickerFailureAlert, slackAlertEnvFromProcess } from './slackAlert'

// Invoked by judge-guard.yml's "Check and post the 7-day picker-failure
// alert" step, only when the picker just failed. The two input files are
// each a `gh api repos/$GH_REPO/actions/artifacts?name=...` listing's
// `artifacts[]` array (judge-guard-picker-failure and judge-guard-picker-
// alert — pickerFailures.ts's own constants), already written to disk by the
// step before this one. This module holds no AWS client and makes no GitHub
// API call itself — it is pure decision logic plus the one Slack POST,
// exactly like runPickerCli.ts holds no S3 client (see pickerFailures.ts's
// header for why).
const EnvSchema = z.object({
  GUARD_FAILURE_ARTIFACTS_FILE: z.string().min(1),
  GUARD_ALERT_ARTIFACTS_FILE: z.string().min(1),
  GUARD_PR_NUMBER: z.string().regex(/^\d+$/),
  GUARD_RUN_ID: z.string().min(1),
  GUARD_FAILURE_REASON: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const readArtifacts = (path: string): Artifact[] => {
  const parsed = z
    .array(z.unknown())
    .parse(JSON.parse(readFileSync(path, 'utf8')))
  const artifacts: Artifact[] = []
  for (const entry of parsed) {
    const result = ArtifactSchema.safeParse(entry)
    // Tolerant of a shape the Actions API adds later: a picker failure must
    // never turn into a CLI crash, the same tolerance runPicker.ts's
    // failure-handling table gives every other bookkeeping step.
    if (result.success) artifacts.push(result.data)
  }
  return artifacts
}

const writeOutput = (path: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const failureArtifacts = readArtifacts(env.GUARD_FAILURE_ARTIFACTS_FILE)
  const alertArtifacts = readArtifacts(env.GUARD_ALERT_ARTIFACTS_FILE)
  const now = new Date()

  const due =
    shouldAlert(failureArtifacts, now) && !alertedRecently(alertArtifacts, now)

  // Only a POST THAT ACTUALLY LANDED writes the dedup marker. Marking a
  // failed post as "alerted" would suppress every future alert for this
  // streak for a full day on, say, a missing Slack secret — exactly the
  // silent-failure shape the TDD's "once is noise, a pattern is a signal"
  // alert exists to avoid.
  let posted = false
  if (due) {
    const result = await postPickerFailureAlert(
      slackAlertEnvFromProcess(),
      'Universal judge guard: the picker has failed twice in the last 7 ' +
        `days. Latest: PR #${env.GUARD_PR_NUMBER}, run ${env.GUARD_RUN_ID} ` +
        `(${env.GUARD_FAILURE_REASON}). This likely means a broken prompt ` +
        'or a model change.',
    )
    posted = result.posted
    if (!result.posted) {
      console.error(
        `::warning::guard picker: could not post the Slack alert: ${result.reason}`,
      )
    }
  }

  writeOutput(env.GITHUB_OUTPUT, 'alerted', String(posted))
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
