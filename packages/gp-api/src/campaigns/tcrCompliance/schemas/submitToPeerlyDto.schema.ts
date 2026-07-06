import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import {
  tcrComplianceBaseShape,
  tcrComplianceSuperRefine,
  tcrComplianceTransform,
} from './tcrComplianceBase.schema'
import {
  getUrlHostname,
  urlHasCredentials,
} from '../../../shared/util/strings.util'

export class SubmitToPeerlyDto extends createZodDto(
  z
    .object({
      ein: tcrComplianceBaseShape.ein,
      committeeName: tcrComplianceBaseShape.committeeName,
      filingUrl: tcrComplianceBaseShape.filingUrl,
      email: tcrComplianceBaseShape.email,
      phone: tcrComplianceBaseShape.phone,
      officeLevel: tcrComplianceBaseShape.officeLevel,
      fecCommitteeId: tcrComplianceBaseShape.fecCommitteeId,
      committeeType: tcrComplianceBaseShape.committeeType,
      websiteUrl: z.string().url(),
    })
    .superRefine((data, ctx) => {
      tcrComplianceSuperRefine(data, ctx, { requireFecCommitteeId: false })

      // Credentialed website URLs would make getUrlHostname read the host
      // from after the '@', dodging the own-website comparison below. Reject
      // them so the comparison can't be fooled (filingUrl is guarded the same
      // way in tcrComplianceSuperRefine).
      if (urlHasCredentials(data.websiteUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Website URL must be a plain public URL without embedded ' +
            'credentials (no "user@host")',
          path: ['websiteUrl'],
        })
        return
      }

      // The candidate's own campaign website is not an official filing
      // record, so CampaignVerify can't match them against it. The agent
      // must supply the election-authority filing URL, not the site it just
      // published.
      const filingHost = getUrlHostname(data.filingUrl)
      if (filingHost && filingHost === getUrlHostname(data.websiteUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Filing URL must be the official election-authority filing ' +
            'record, not the campaign website itself',
          path: ['filingUrl'],
        })
      }
    })
    .transform(tcrComplianceTransform),
) {}
