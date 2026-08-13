import { z } from 'zod'
import {
  addFilingUrlIssues,
  addNonFederalFecFilingUrlIssue,
  tcrComplianceBaseShape,
} from './tcrComplianceBase.schema'
import { getUrlHostname } from '../../../shared/util/strings.util'
import { OfficeLevel } from '../../../generated/prisma'

// submit-to-peerly takes no request body: gp-api sources every Peerly field
// from the persisted TcrCompliance record and the campaign's registered
// domain (the agent only needs the campaign context, resolved by
// @UseCampaign). This schema re-applies PR #643's filing-URL guards to those
// *persisted* values at submit time — a record saved before the guard shipped
// can still carry a goodparty.org page, the candidate's own campaign site, or
// (for non-federal candidates) an FEC filing URL, all of which CampaignVerify
// deterministically rejects.
export const submitToPeerlyFilingSchema = z
  .object({
    filingUrl: tcrComplianceBaseShape.filingUrl,
    officeLevel: tcrComplianceBaseShape.officeLevel,
    // The campaign's registered apex domain (Domain.name), used only for the
    // own-site comparison below — never persisted from here.
    websiteHost: z.string(),
  })
  .superRefine((data, ctx) => {
    addFilingUrlIssues(data.filingUrl, ctx)

    if (data.officeLevel !== OfficeLevel.federal) {
      addNonFederalFecFilingUrlIssue(data.filingUrl, ctx)
    } else {
      const federalFilingHost = getUrlHostname(data.filingUrl)
      if (
        federalFilingHost !== 'fec.gov' &&
        !federalFilingHost.endsWith('.fec.gov')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Election Filing Link must be from FEC.gov for federal office level',
          path: ['filingUrl'],
        })
      }
    }

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
