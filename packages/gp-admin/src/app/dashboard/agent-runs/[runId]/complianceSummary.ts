// The artifact is opaque to gp-api (typed `Record<string, unknown>`); the known
// compliance_setup fields are interpreted here. Every field is optional because
// a RUNNING or partially-failed run may not have written it yet.

export const COMPLIANCE_SETUP_EXPERIMENT = 'compliance_setup'

export interface ComplianceSummary {
  stage?: string
  domainName?: string
  peerlyStatus?: string
  blockers: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function getStringArray(
  record: Record<string, unknown>,
  key: string
): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function parseComplianceSummary(
  artifact: Record<string, unknown>
): ComplianceSummary {
  const domain = isRecord(artifact.domain) ? artifact.domain : undefined
  const tcrSubmission = isRecord(artifact.tcr_submission)
    ? artifact.tcr_submission
    : undefined

  return {
    stage: getString(artifact, 'stage'),
    domainName: domain ? getString(domain, 'name') : undefined,
    peerlyStatus: tcrSubmission
      ? getString(tcrSubmission, 'status')
      : undefined,
    blockers: getStringArray(artifact, 'blockers_encountered'),
  }
}
