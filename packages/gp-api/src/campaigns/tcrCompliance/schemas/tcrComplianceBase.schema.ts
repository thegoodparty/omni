import { z } from 'zod'
import { PhoneSchema } from '@goodparty_org/contracts'
import {
  EinSchema,
  StateSchema,
  UrlOrDomainSchema,
  WriteEmailSchema,
} from '../../../shared/schemas'
import { CommitteeType, OfficeLevel } from '../../../generated/prisma'
import {
  getUrlHostname,
  urlHasCredentials,
  urlIncludesPath,
} from '../../../shared/util/strings.util'
import { Logger } from '@nestjs/common'

const logger = new Logger('TcrComplianceDto')

export const FEC_COMMITTEE_ID_PATTERN = /^C\d{8}$/

// Google Places autocomplete never suggests PO Boxes (and misses some rural
// addresses), yet election filings commonly use them — so a Google match
// cannot be a hard requirement. A candidate who can't get a suggestion
// submits these structured components instead, and the Peerly submissions
// read them directly rather than resolving campaign.placeId.
export const ManualFilingAddressSchema = z.object({
  addressLine1: z.string().trim().min(1, 'A street or PO Box is required'),
  addressLine2: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  city: z.string().trim().min(1, 'A city is required'),
  state: StateSchema().transform((value) => value.toUpperCase()),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'A valid ZIP code is required'),
})

export type ManualFilingAddress = z.infer<typeof ManualFilingAddressSchema>

export const formatManualFilingAddress = (
  address: ManualFilingAddress,
): string =>
  [
    address.addressLine1,
    address.addressLine2,
    `${address.city}, ${address.state} ${address.zip}`,
  ]
    .filter(Boolean)
    .join(', ')

export const tcrComplianceBaseShape = {
  ein: EinSchema,
  // The candidate's own name — distinct from the account holder's, since a
  // campaign manager often signs up under their own name. Sent to Peerly's
  // Campaign Verify request so CV can reconcile against the election filing,
  // which names the candidate, not whoever created the account.
  candidateName: z.string().trim().min(1, 'A candidate name is required'),
  // A resolved address is a hard precondition: the Peerly submission derives
  // the candidate's postal address from placeId (or the manual components
  // above), so starting compliance with a blank address only fails several
  // paid steps later at the submit. The one-of requirement is enforced in
  // tcrComplianceSuperRefine. `.trim()` runs before `.min(1)` so a
  // whitespace-only value can't slip through and get persisted to the
  // campaign by createAgentic ahead of the service-level `.trim()` guards.
  // Only the create DTOs pick these fields; the submit path has no request
  // body — it reuses the persisted address.
  placeId: z
    .string()
    .trim()
    .min(1, 'A candidate address is required')
    .optional(),
  formattedAddress: z
    .string()
    .trim()
    .min(1, 'A candidate address is required')
    .optional(),
  manualAddress: ManualFilingAddressSchema.optional(),
  // committeeName is sent to Peerly's 10DLC brand approval and interpolated
  // into the sample SMS messages, so a whitespace-only value produces a
  // malformed sample that fails the paid Peerly step. Trim + min like the
  // address fields. The submit path reads the persisted (non-empty) committee
  // name off the TcrCompliance row rather than the request.
  committeeName: z.string().trim().min(1, 'A committee name is required'),
  filingUrl: UrlOrDomainSchema.refine(urlIncludesPath, {
    message:
      'Filing URL must include path (e.g. https://example.com/filing, not just https://example.com)',
  }),
  email: WriteEmailSchema,
  phone: PhoneSchema,
  officeLevel: z.nativeEnum(OfficeLevel),
  // Normalize '' -> undefined: the agent sends empty strings for fields it
  // can't resolve, and a falsy-but-not-nullish '' would slip past the relaxed
  // federal check AND short-circuit the service's `?? existing.fecCommitteeId`
  // fallback, re-breaking the very stranding this is meant to fix.
  fecCommitteeId: z
    .string()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  committeeType: z.nativeEnum(CommitteeType).optional(),
}

type TcrComplianceBaseData = {
  officeLevel: OfficeLevel
  fecCommitteeId?: string
  committeeType?: CommitteeType
  filingUrl: string
  placeId?: string
  formattedAddress?: string
  manualAddress?: ManualFilingAddress
}

export const addFilingUrlIssues = (filingUrl: string, ctx: z.RefinementCtx) => {
  // The WHATWG parser treats any text before an '@' as userinfo, so
  // https://goodparty.org@sos.gov/x parses hostname 'sos.gov' and would slip
  // the host guard below. A public filing URL never carries credentials.
  if (urlHasCredentials(filingUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Filing URL must be a plain public URL without embedded ' +
        'credentials (no "user@host")',
      path: ['filingUrl'],
    })
  }

  // goodparty.org is our own marketing/profile site, never an official
  // election filing. The compliance agent was resolving filing URLs to
  // goodparty.org candidate pages, so CampaignVerify couldn't match the
  // candidate against a filing and had to contact the election authority by
  // hand. Reject it here so the agent must supply a real filing record.
  const filingHost = getUrlHostname(filingUrl)
  if (filingHost === 'goodparty.org' || filingHost.endsWith('.goodparty.org')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Filing URL must be an official election-authority filing record ' +
        '(Secretary of State, county or city clerk, or FEC), not a ' +
        'goodparty.org page',
      path: ['filingUrl'],
    })
  }
}

// CampaignVerify rejects FEC-hosted filing URLs outright for state/local
// verifications ("FEC filing URLs are not allowed.") — a state or local
// candidate's filing lives with their state or local election authority, so
// an FEC URL is deterministically unsubmittable. Shared by the create-side
// superRefine and the submit-time re-check so both layers stay in lockstep
// (federal is the opposite: the create schema *requires* an FEC.gov link).
export const addNonFederalFecFilingUrlIssue = (
  filingUrl: string,
  ctx: z.RefinementCtx,
) => {
  const filingHost = getUrlHostname(filingUrl)
  if (filingHost === 'fec.gov' || filingHost.endsWith('.fec.gov')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Election Filing Link must be from the state or local election ' +
        'authority for non-federal office level, not FEC.gov — Campaign ' +
        'Verify rejects FEC filing URLs for state and local candidates',
      path: ['filingUrl'],
    })
  }
}

export const tcrComplianceSuperRefine = <T extends TcrComplianceBaseData>(
  data: T,
  ctx: z.RefinementCtx,
  // The agent submit path (submitToPeerlyForAgent) defers the federal
  // "fecCommitteeId required" check to the service, which falls back to the
  // value persisted on the TcrCompliance row when the request omits it. Format
  // is still validated here whenever a value IS present.
  options: { requireFecCommitteeId?: boolean } = {},
) => {
  const { requireFecCommitteeId = true } = options

  addFilingUrlIssues(data.filingUrl, ctx)

  // Address one-of: a Google-resolved (placeId + formattedAddress) pair or a
  // manual structured address. Neither means the paid Peerly submit would
  // fail later with no address to send.
  const hasResolvedAddress = Boolean(data.placeId && data.formattedAddress)
  if (!hasResolvedAddress && !data.manualAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'A candidate address is required — select an address suggestion ' +
        'or enter the address manually',
      path: ['placeId'],
    })
  }

  const isFederal = data.officeLevel === OfficeLevel.federal

  if (isFederal) {
    if (data.fecCommitteeId) {
      if (!FEC_COMMITTEE_ID_PATTERN.test(data.fecCommitteeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'FEC Committee ID must be "C" followed by 8 digits (e.g., C00123456)',
          path: ['fecCommitteeId'],
        })
      }
    } else if (requireFecCommitteeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FEC Committee ID is required for federal office level',
        path: ['fecCommitteeId'],
      })
    }

    const federalCommitteeTypes = new Set<CommitteeType>([
      CommitteeType.HOUSE,
      CommitteeType.SENATE,
      CommitteeType.PRESIDENTIAL,
    ])
    if (!data.committeeType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Committee Type is required for federal office level',
        path: ['committeeType'],
      })
    } else if (!federalCommitteeTypes.has(data.committeeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Committee Type must be HOUSE, SENATE, or PRESIDENTIAL for federal office level',
        path: ['committeeType'],
      })
    }

    if (!/fec\.gov/i.test(data.filingUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Election Filing Link must be from FEC.gov for federal office level',
        path: ['filingUrl'],
      })
    }
  } else {
    if (data.fecCommitteeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'FEC Committee ID should not be provided for non-federal office level',
        path: ['fecCommitteeId'],
      })
    }
    if (data.committeeType && data.committeeType !== CommitteeType.CANDIDATE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Committee Type must be CANDIDATE for non-federal office level',
        path: ['committeeType'],
      })
    }
    addNonFederalFecFilingUrlIssue(data.filingUrl, ctx)
  }
}

export const tcrComplianceTransform = <T extends TcrComplianceBaseData>(
  data: T,
): T & { committeeType: CommitteeType } => {
  if (data.committeeType) {
    return { ...data, committeeType: data.committeeType }
  }

  if (data.officeLevel !== OfficeLevel.federal) {
    logger.warn(
      `committeeType not provided for non-federal officeLevel "${data.officeLevel}", defaulting to CANDIDATE`,
    )
    return { ...data, committeeType: CommitteeType.CANDIDATE }
  }

  throw new Error(
    'committeeType is required for federal office level (validation should have caught this)',
  )
}
