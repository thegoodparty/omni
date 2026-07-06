import { z } from 'zod'
import { PhoneSchema } from '@goodparty_org/contracts'
import {
  EinSchema,
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

export const tcrComplianceBaseShape = {
  ein: EinSchema,
  // A resolved address is a hard precondition: the Peerly submission derives
  // the candidate's postal address from placeId, so starting compliance with a
  // blank address only fails several paid steps later at the submit. Reject it
  // at the boundary. `.trim()` runs before `.min(1)` so a whitespace-only value
  // can't slip through and get persisted to the campaign by createAgentic ahead
  // of the service-level `.trim()` guards. Only the create DTOs pick these
  // fields; SubmitToPeerlyDto omits them (it reuses the persisted address).
  placeId: z.string().trim().min(1, 'A candidate address is required'),
  formattedAddress: z.string().trim().min(1, 'A candidate address is required'),
  // committeeName is sent to Peerly's 10DLC brand approval and interpolated
  // into the sample SMS messages, so a whitespace-only value produces a
  // malformed sample that fails the paid Peerly step. Trim + min like the
  // address fields. SubmitToPeerlyDto reuses this field; the agent always sends
  // the campaign's persisted (non-empty) committee name.
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
}

const addFilingUrlIssues = (filingUrl: string, ctx: z.RefinementCtx) => {
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
