import { z } from 'zod'
import {
  addFilingUrlIssues,
  tcrComplianceBaseShape,
} from './tcrComplianceBase.schema'
import { getUrlHostname } from '../../../shared/util/strings.util'

// submit-to-peerly takes no request body: gp-api sources every Peerly field
// from the persisted TcrCompliance record and the campaign's registered
// domain (the agent only needs the campaign context, resolved by
// @UseCampaign). This schema re-applies PR #643's filing-URL guards to those
// *persisted* values at submit time — a record saved before the guard shipped
// can still carry a goodparty.org page or the candidate's own campaign site,
// which CampaignVerify can't verify a candidate against.
export const submitToPeerlyFilingSchema = z
  .object({
    filingUrl: tcrComplianceBaseShape.filingUrl,
    // The campaign's registered apex domain (Domain.name), used only for the
    // own-site comparison below — never persisted from here.
    websiteHost: z.string(),
  })
  .superRefine((data, ctx) => {
    addFilingUrlIssues(data.filingUrl, ctx)

    // The candidate's own campaign website is not an official filing record,
    // so CampaignVerify can't match them against it. getUrlHostname lowercases
    // and strips www. on both sides so the comparison is scheme/www-agnostic.
    const filingHost = getUrlHostname(data.filingUrl)
    if (filingHost && filingHost === getUrlHostname(data.websiteHost)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Filing URL must be the official election-authority filing ' +
          'record, not the campaign website itself',
        path: ['filingUrl'],
      })
    }
  })
