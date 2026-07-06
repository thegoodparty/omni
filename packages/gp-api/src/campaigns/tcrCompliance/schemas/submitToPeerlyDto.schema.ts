import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import {
  tcrComplianceBaseShape,
  tcrComplianceSuperRefine,
  tcrComplianceTransform,
} from './tcrComplianceBase.schema'
import { getUrlHostname } from '../../../shared/util/strings.util'

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
