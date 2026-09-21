'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import type {
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
} from '@goodparty_org/contracts'
import { PERMISSIONS } from '@/lib/permissions'
import { getOutreachResultsGateway } from './gateway'
import { checkResultsFile, uploadBlocker } from './lib/checkResultsFile'
import { commitResults, requestParseReport } from './lib/resultsUpload'
import { type OutreachResultsTarget } from './types'

const ADMIN_ROLE = 'org:admin'

// Reading the inbox is a work-queue view, so it rides the same
// read_campaigns permission as the CAS SMS queue beside it.
async function requireReader() {
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS })) {
    throw new Error('Missing read_campaigns permission')
  }
}

// Committing results writes per-person message rows, flips opt-out state on
// constituent records and advances the send to completed. That is the same
// weight as deciding an SMS campaign, so it carries the same org:admin gate.
// A dry run writes nothing, but it is the step immediately before the one
// that does, so it is gated identically rather than leaving a half-usable
// page for someone who cannot finish.
async function requireUploader() {
  const { has } = await auth()
  if (!has?.({ role: ADMIN_ROLE })) {
    throw new Error('Only admins can upload outreach results')
  }
  const user = await currentUser()
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new Error('Could not resolve your admin identity')
  }
  return { email }
}

export const getAwaitingResults =
  async (): Promise<OutreachAwaitingResultsResponse> => {
    await requireReader()
    return getOutreachResultsGateway().listAwaiting()
  }

export const getResultsTarget = async (
  outreachId: number
): Promise<OutreachResultsTarget> => {
  await requireReader()
  return getOutreachResultsGateway().getTarget(outreachId)
}

interface UploadArgs {
  outreachId: number
  fileName: string
  csv: string
}

// A server action is a public POST endpoint. Whatever the page did before
// calling it is fast feedback, not a gate: this is the only place the file
// is actually checked, and it applies the same rules by calling the same
// module the page does. Both branches below run it, so a truncated or
// unreadable file cannot reach gp-api — and for a poll cannot reach S3,
// where the bytes are written exactly as received.
function assertUploadable({ fileName, csv }: UploadArgs) {
  const blocker = uploadBlocker(checkResultsFile({ fileName, csv }))
  if (blocker) throw new Error(blocker)
}

// `sourceLabel` is the audit trail the ingest stores: which human returned
// this file, for a send whose results nobody can otherwise trace back.
export const dryRunResultsUpload = async (
  args: UploadArgs
): Promise<OutreachResultsParseReport> => {
  const { email } = await requireUploader()
  assertUploadable(args)
  return requestParseReport(getOutreachResultsGateway(), {
    ...args,
    sourceLabel: `gp-admin upload by ${email}`,
  })
}

export const commitResultsUpload = async (
  args: UploadArgs
): Promise<OutreachResultsParseReport> => {
  const { email } = await requireUploader()
  assertUploadable(args)
  const report = await commitResults(getOutreachResultsGateway(), {
    ...args,
    sourceLabel: `gp-admin upload by ${email}`,
  })
  revalidatePath('/dashboard/outreach-results')
  revalidatePath(`/dashboard/outreach-results/${args.outreachId}`)
  return report
}
