import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import type {
  ComplianceStateOutput,
  PinDelivery,
} from '@goodparty_org/contracts'
import type { TcrCompliance, TcrComplianceStatus } from 'helpers/types'

export const TCR_COMPLIANCE_QUERY_KEY = ['tcrCompliance'] as const

export const COMPLIANCE_STATE_QUERY_KEY = ['complianceState'] as const

export const TCR_COMPLIANCE_STATUS: {
  SUBMITTED: 'submitted'
  PENDING: 'pending'
  APPROVED: 'approved'
  REJECTED: 'rejected'
  ERROR: 'error'
} = {
  SUBMITTED: 'submitted',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ERROR: 'error',
}

// Statuses that mean the registration form has been submitted (peerly may
// still be processing).
const FILING_COMPLETE_STATUSES: TcrComplianceStatus[] = [
  TCR_COMPLIANCE_STATUS.SUBMITTED,
  TCR_COMPLIANCE_STATUS.PENDING,
  TCR_COMPLIANCE_STATUS.APPROVED,
]

// Statuses that mean PIN verification has happened (or is no longer required).
const PIN_COMPLETE_STATUSES: TcrComplianceStatus[] = [
  TCR_COMPLIANCE_STATUS.PENDING,
  TCR_COMPLIANCE_STATUS.APPROVED,
]

export interface TcrComplianceStatusCompletions {
  filingComplete: boolean
  pinComplete: boolean
}

export const getTcrComplianceStatusCompletions = (
  tcrCompliance: TcrCompliance | null | undefined,
): TcrComplianceStatusCompletions => {
  const status = tcrCompliance?.status ?? null
  return {
    filingComplete:
      status !== null && FILING_COMPLETE_STATUSES.includes(status),
    pinComplete: status !== null && PIN_COMPLETE_STATUSES.includes(status),
  }
}

export const getTcrCompliance = async (): Promise<TcrCompliance | null> => {
  const response = await clientFetch<TcrCompliance | null>(
    apiRoutes.campaign.tcrCompliance.fetch,
  )
  if (!response.ok) return null
  return response.data ?? null
}

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@')
  if (!domain || !local) return email
  return `${local.slice(0, 1)}•••@${domain}`
}

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return phone
  const last4 = digits.slice(-4)
  const area = digits.length >= 10 ? digits.slice(-10, -7) : ''
  return area ? `(${area}) •••-${last4}` : `•••-${last4}`
}

// Sentence telling the candidate where Peerly sent their PIN, with the
// destination lightly masked. Returns null when Peerly hasn't reported a
// delivery yet so the caller falls back to the generic "email, phone or
// address" copy.
export const describePinDelivery = (
  pinDelivery: PinDelivery | null | undefined,
): string | null => {
  if (!pinDelivery) return null
  const { method, destination } = pinDelivery
  switch (method) {
    case 'email':
      return `We sent your PIN by email to ${maskEmail(destination)}.`
    case 'text':
      return `We sent your PIN by text to ${maskPhone(destination)}.`
    case 'phone':
    case 'call':
      return `We sent your PIN by phone to ${maskPhone(destination)}.`
    case 'mail':
      return `We mailed your PIN to ${destination}.`
  }
}

export const getComplianceState =
  async (): Promise<ComplianceStateOutput | null> => {
    const response = await clientFetch<ComplianceStateOutput | null>(
      apiRoutes.campaign.tcrCompliance.complianceState,
    )
    if (!response.ok) return null
    return response.data ?? null
  }
