/**
 * CI ratchet: SQS job types and @nestjs/schedule jobs may only shrink.
 *
 * New background work goes on pg-boss (src/jobs/AGENTS.md). This fails a PR
 * that adds a QueueType value or an @Cron/@Interval, and one that removes one
 * without lowering the baseline below, so the baseline never has headroom.
 *
 * A genuine exception (a message another system sends, a job that needs a
 * seconds field) raises the baseline in the same PR, where review sees it.
 *
 * Usage: npx tsx scripts/check-legacy-background-work.ts
 */
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..')

export const QUEUE_TYPES = [
  'TCR_COMPLIANCE_STATUS_CHECK',
  'DOMAIN_EMAIL_FORWARDING',
  'POLL_ANALYSIS_COMPLETE',
  'FEEDBACK_SYNTHESIS_COMPLETE',
  'PANEL_REPLIES_UPLOADED',
  'POLL_CREATION',
  'POLL_EXPANSION',
  'CAMPAIGN_PLAN_COMPLETE',
  'CAMPAIGN_STORY_COMPLETED',
  'AGENT_EXPERIMENT_RESULT',
  'AGENTIC_COMPLIANCE_KICKOFF',
  'OCR_ATTACHMENT',
  'NIGHTLY_10DLC_REPORT',
  'PEERLY_VENDOR_ESCALATION',
  'CV_STATUS_POLL',
  'ORDINANCE_QUALITY_LOOP',
  'EXTRACT_CHAT_ATTACHMENT',
  'OUTREACH_TEXT_SEND',
  'P2P_PHONE_LIST_BUILD',
  'EMAIL_SEND_PREPARE',
  'EMAIL_INBOUND',
]

export const SCHEDULED_JOBS: Record<string, number> = {
  'src/agentExperiments/services/experimentRuns.service.ts': 1,
  'src/campaigns/campaignTracker/services/campaignTrackerDispatch.service.ts': 1,
  'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service.ts': 3,
  'src/campaigns/tcrCompliance/services/cvStatusPoll.service.ts': 2,
  'src/campaigns/tcrCompliance/services/nightly10DlcReport.service.ts': 2,
  'src/communityIssues/services/communityIssueDispatch.service.ts': 2,
  'src/constituentFeedback/services/pendingTranscription.service.ts': 1,
  'src/constituentFeedback/services/synthesisStaleRunSweep.service.ts': 1,
  'src/contactUploads/services/contactUploadAbandonedSweep.service.ts': 1,
  'src/doorKnocking/services/doorKnockingStats.service.ts': 1,
  'src/electedOffice/services/winOffice.service.ts': 1,
  'src/emailOutreach/services/outreachEmailEvents.service.ts': 1,
  'src/emailOutreach/services/outreachEmailLifecycle.service.ts': 2,
  'src/emailOutreach/services/outreachEmailSendSweep.service.ts': 1,
  'src/managedPanelWaves/managedPanelWaveJob.service.ts': 1,
  'src/meetings/services/meetingBriefings.service.ts': 1,
  'src/ordinances/services/ordinanceDispatch.service.ts': 1,
  'src/ordinances/services/ordinanceQualityLoop.service.ts': 1,
  'src/outreach/services/managedPanelFundingReconcile.service.ts': 1,
  'src/outreach/services/outreachCompletion.service.ts': 1,
  'src/outreach/services/outreachDraftExpiry.service.ts': 1,
  'src/outreach/services/outreachInboundSweep.service.ts': 2,
  'src/outreach/services/outreachP2pSmsCapture.service.ts': 1,
  'src/outreach/services/outreachP2pSmsReconcile.service.ts': 3,
  'src/outreach/services/outreachPollReviewOverdue.service.ts': 1,
  'src/outreach/services/outreachRobocallBacklogAlert.service.ts': 1,
  'src/outreach/services/outreachRobocallCallhubCleanup.service.ts': 1,
  'src/outreach/services/outreachRobocallCapture.service.ts': 1,
  'src/outreach/services/outreachRobocallCompletion.service.ts': 1,
  'src/outreach/services/outreachRobocallDeferredHold.service.ts': 2,
  'src/outreach/services/outreachRobocallFreshCharge.service.ts': 1,
  'src/outreach/services/outreachRobocallHoldFailure.service.ts': 2,
  'src/outreach/services/outreachRobocallHoldReconcile.service.ts': 1,
  'src/outreach/services/outreachRobocallHoldRecovery.service.ts': 1,
  'src/outreach/services/outreachRobocallOverdueAlert.service.ts': 1,
  'src/outreach/services/outreachRobocallSend.service.ts': 1,
  'src/outreach/services/outreachRobocallStaging.service.ts': 1,
  'src/outreach/services/outreachRobocallStranded.service.ts': 1,
  'src/outreach/services/outreachTextHandoff.service.ts': 1,
  'src/personProfiles/services/person-id-reconcile.service.ts': 1,
  'src/priorities/services/priorityAnswerCoding.service.ts': 1,
  'src/priorities/services/priorityRoundTwoDraw.service.ts': 1,
  'src/raceOpponent/services/opponentResearchSchedule.service.ts': 1,
  'src/scheduled-messaging/scheduled-messaging.service.ts': 1,
  'src/users/services/sessions.service.ts': 1,
  'src/users/services/users.service.ts': 1,
  'src/vendorMocks/vendorMockRecordAudit.service.ts': 1,
  'src/vendors/peerly/services/p2pPhoneListUpload.service.ts': 2,
  'src/vendors/vendorDriftProbe.service.ts': 1,
}

export const parseQueueTypes = (source: string): string[] => {
  const body = /export enum QueueType \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
}

export const countScheduledJobs = (source: string): number =>
  source.match(/^\s*@(Cron|Interval)\(/gm)?.length ?? 0

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })

export const findProblems = (
  queueTypes: string[],
  scheduled: Record<string, number>,
): string[] => {
  const problems: string[] = []
  for (const name of queueTypes) {
    if (!QUEUE_TYPES.includes(name)) {
      problems.push(
        `New QueueType ${name}. New background work goes on pg-boss ` +
          '(src/jobs/AGENTS.md), not SQS.',
      )
    }
  }
  for (const name of QUEUE_TYPES) {
    if (!queueTypes.includes(name)) {
      problems.push(
        `QueueType ${name} is gone. Remove it from QUEUE_TYPES in ` +
          'scripts/check-legacy-background-work.ts.',
      )
    }
  }
  const files = new Set([
    ...Object.keys(scheduled),
    ...Object.keys(SCHEDULED_JOBS),
  ])
  for (const file of [...files].sort()) {
    const actual = scheduled[file] ?? 0
    const allowed = SCHEDULED_JOBS[file] ?? 0
    if (actual > allowed) {
      problems.push(
        `${file} has ${actual} @Cron/@Interval, baseline ${allowed}. New ` +
          'scheduled work goes on pg-boss SCHEDULES (src/jobs/AGENTS.md).',
      )
    } else if (actual < allowed) {
      problems.push(
        `${file} has ${actual} @Cron/@Interval, baseline ${allowed}. Lower ` +
          'SCHEDULED_JOBS in scripts/check-legacy-background-work.ts.',
      )
    }
  }
  return problems
}

const main = () => {
  const queueTypes = parseQueueTypes(
    readFileSync(join(ROOT, 'src/queue/queue.types.ts'), 'utf8'),
  )
  const scheduled: Record<string, number> = {}
  for (const path of listSourceFiles(join(ROOT, 'src'))) {
    const count = countScheduledJobs(readFileSync(path, 'utf8'))
    if (count > 0) scheduled[relative(ROOT, path)] = count
  }
  const problems = findProblems(queueTypes, scheduled)
  if (problems.length === 0) {
    console.log('Legacy background work: no new SQS job types or @Cron jobs.')
    return
  }
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

if (require.main === module) main()
