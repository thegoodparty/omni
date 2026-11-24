import { createHmac } from 'node:crypto'
import {
  CASE_SCOUT_HANDOFF_VERSION,
  CaseScoutHandoffSchema,
  type CaseScoutHandoff,
} from '@goodparty_org/contracts'
import type { Bundle, Manifest } from '../schemas/caseScoutBucket.schema'
import { WITHHELD_NEEDS_SETUP } from './gate.util'

// The night's handoff to the Delegate swarm, built from bundle.json and
// nothing else. Only gated fields cross: a draft's turns (or its question),
// condition, handledWhen and caseId, and a needs-setup line that passed the
// gate. failureSummary, list-full and held drafts, removals, the withheld
// placeholder and every source id stay in the bucket.
export const buildHandoff = (
  bundle: Bundle,
  environment: CaseScoutHandoff['environment'],
): CaseScoutHandoff =>
  CaseScoutHandoffSchema.parse({
    version: CASE_SCOUT_HANDOFF_VERSION,
    runId: bundle.runId,
    environment,
    cases: bundle.drafts.map(({ agentId, severity, case: drafted }) => ({
      suite: agentId,
      id: drafted.caseId,
      turns:
        drafted.turns ??
        (drafted.question === undefined ? [] : [drafted.question]),
      grading: {
        condition: drafted.condition,
        handledWhen: drafted.handledWhen,
      },
      severity,
    })),
    needsSetup: bundle.needsSetup
      .filter(({ what }) => what !== WITHHELD_NEEDS_SETUP)
      .map(({ agentId, severity, what }) => ({
        suite: agentId,
        what,
        severity,
      })),
  })

// A second check behind the gate, on the exact bytes that leave: the night's
// conversation, session and message ids must not appear anywhere in them.
export const namesASourceId = (body: string, manifest: Manifest): boolean =>
  manifest.sessions.some(
    (session) =>
      body.includes(session.conversationId) ||
      body.includes(session.sessionId) ||
      session.messageIds.some((messageId) => body.includes(messageId)),
  )

// Unique per environment and night, so the swarm can drop a redelivery and
// a dev night never collides with the prod night of the same date.
export const handoffWebhookId = (
  environment: CaseScoutHandoff['environment'],
  runId: string,
): string => `case-scout-${environment}-${runId}`

const WEBHOOK_SECRET_PREFIX = 'whsec_'

// Standard Webhooks (standardwebhooks.com): HMAC-SHA256 over
// "<webhook-id>.<webhook-timestamp>.<body>", keyed by the base64 part of a
// whsec_ secret, sent as "v1,<base64 signature>".
export const signStandardWebhook = ({
  webhookId,
  timestamp,
  body,
  secret,
}: {
  webhookId: string
  timestamp: string
  body: string
  secret: string
}): string => {
  const key = secret.startsWith(WEBHOOK_SECRET_PREFIX)
    ? Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), 'base64')
    : Buffer.alloc(0)
  if (key.length === 0) {
    throw new Error(
      'CASE_SCOUT_DELEGATE_WEBHOOK_SECRET is not a whsec_ secret with a key',
    )
  }
  const signature = createHmac('sha256', key)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest('base64')
  return `v1,${signature}`
}
