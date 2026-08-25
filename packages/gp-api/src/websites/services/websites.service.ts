import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Prisma, User } from '../../generated/prisma'
import axios, { AxiosError } from 'axios'
import * as dns from 'node:dns'
import { promisify } from 'node:util'
import * as http from 'node:http'
import * as https from 'node:https'
import ipaddr from 'ipaddr.js'
import { CampaignWith } from 'src/campaigns/campaigns.types'
import {
  VerifyLiveReason,
  VerifyLiveResponse,
} from '../schemas/VerifyLive.schema'
import { isGenuineIssue } from '@goodparty_org/contracts'
import {
  hasRenderableName,
  isGenericComplianceContent,
} from '../util/genericContent.util'

const dnsLookup = promisify(dns.lookup)

export type PositionWithTopIssue = Prisma.CampaignPositionGetPayload<{
  include: { topIssue: true }
}>

type WebsiteIssue = NonNullable<
  NonNullable<PrismaJson.WebsiteContent['about']>['issues']
>[number]

const hasText = (value?: string | null): boolean =>
  typeof value === 'string' && value.trim().length > 0

// Map a campaign's positions to publishable issues, keeping only complete ones
// (real title AND description). Placeholder copy like "Issue 1" would survive
// the publish-readiness check and ship literally to a candidate's site.
const realIssuesFromCampaign = (
  campaign: CampaignWith<'campaignPositions'>,
): { title: string; description: string }[] =>
  // Prisma include query — TypeScript cannot narrow the included topIssue relation
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  (campaign.campaignPositions as PositionWithTopIssue[])
    .map((position) => ({
      title: position.topIssue?.name ?? '',
      description: position.description ?? '',
    }))
    .filter((issue) => hasText(issue.title) && hasText(issue.description))

// The compliance_setup agent publishes an existing website but cannot author
// missing copy. Legacy-Pro candidates reach the agentic flow without the
// pre-payment candidate-profile step that creates the site, so the agent's
// publish call would 400 on the empty publish-gated fields. Backfill
// contact.email and seed about.issues from real campaign positions when
// present, but never invent a bio or a default issue — Peerly rejects
// templated content as "not genuine". A site with no genuine bio/issues
// simply stays unpublishable (the publish gate rejects it; the agent fails
// profile_incomplete). Returns patched content, or null when nothing needed
// filling.
export const applyCompliancePublishFallbacks = (
  content: PrismaJson.WebsiteContent,
  user: User,
  campaign: CampaignWith<'campaignPositions'>,
): PrismaJson.WebsiteContent | null => {
  const about = content.about ?? {}
  const nextAbout = { ...about }
  const contact = content.contact ?? {}
  const nextContact = { ...contact }
  let changed = false

  // Only real candidate-authored issues or real campaign positions ship.
  // isGenuineIssue drops malformed AND default-title entries (the publish gate
  // rejects those too), so a site carrying only the legacy default issue gets
  // it replaced with real positions or left empty — never silently retained.
  // No genuine source => leave issues empty so the publish gate rejects the
  // site and the agent fails profile_incomplete (no generic content reaches
  // Peerly).
  const validIssues = (about.issues ?? []).filter(isGenuineIssue)
  const droppedNonGenuine = validIssues.length !== (about.issues ?? []).length
  const realIssues =
    validIssues.length === 0 ? realIssuesFromCampaign(campaign) : []
  // Fire only on a real change: non-genuine entries to strip, or real positions
  // to seed when there are none. Skip when issues are already genuine or simply
  // absent with nothing to seed — writing [] there is a spurious DB write.
  if (droppedNonGenuine || realIssues.length > 0) {
    nextAbout.issues = validIssues.length > 0 ? validIssues : realIssues
    changed = true
  }

  if (!hasText(contact.email)) {
    nextContact.email = user.email
    changed = true
  }

  return changed ? { ...content, about: nextAbout, contact: nextContact } : null
}

// Whether an agentic kickoff for this campaign would produce a publishable
// website. Mirrors exactly what the kickoff does (apply the fallbacks above,
// then the compliance publish gate) rather than testing the raw content —
// a campaign with no website-authored issues but real positions passes,
// because the fallbacks seed those positions. Used by the dispatch gate so a
// run that would fail terminally at publish_website (profile_incomplete) is
// deferred instead of burned.
export const wouldBePublishableAfterFallbacks = (
  content: PrismaJson.WebsiteContent | null | undefined,
  user: User,
  campaign: CampaignWith<'campaignPositions'>,
): boolean => {
  const base = content ?? {}
  const patched = applyCompliancePublishFallbacks(base, user, campaign)
  return hasRenderableName(user) && !isGenericComplianceContent(patched ?? base)
}

@Injectable()
export class WebsitesService extends createPrismaBase(MODELS.Website) {
  createByCampaign(user: User, campaign: CampaignWith<'campaignPositions'>) {
    // Seed only real positions; a site with none stays unpublishable until the
    // candidate authors genuine issues (the publish gate enforces this).
    const issues = realIssuesFromCampaign(campaign)

    // NOTE: this is in a WIP state, better default content generation TBD
    // TODO: generate AI content here for any missing fields
    return this.model.create({
      data: {
        campaignId: campaign.id,
        vanityPath: campaign.slug,
        content: {
          theme: 'light',
          about: {
            issues,
          },
          contact: {
            email: user.email,
            phone: user.phone ?? undefined,
          },
        },
      },
    })
  }

  update(args: Prisma.WebsiteUpdateArgs) {
    return this.model.update(args)
  }

  // Guarantee the compliance_setup agent's precondition: a publishable website
  // for the campaign. Creates one if the candidate never built it, then
  // backfills empty publish-gated fields via applyCompliancePublishFallbacks.
  async ensureCompliancePublishableWebsite(
    user: User,
    campaign: CampaignWith<'campaignPositions'>,
  ): Promise<void> {
    const existing = await this.model.findUnique({
      where: { campaignId: campaign.id },
    })
    const website = existing ?? (await this.createByCampaign(user, campaign))
    const patched = applyCompliancePublishFallbacks(
      website.content ?? {},
      user,
      campaign,
    )
    if (patched) {
      await this.update({
        where: { campaignId: campaign.id },
        data: { content: patched },
      })
    }
  }

  // The candidate's issues live on the website content (shared with the
  // Pro-upgrade flow), not the campaign story. Returns [] when the campaign
  // has no website yet.
  async getIssuesForCampaign(campaignId: number): Promise<WebsiteIssue[]> {
    const website = await this.model.findUnique({ where: { campaignId } })
    return website?.content?.about?.issues ?? []
  }

  // The candidate's "why" lives on the website bio (shared with the Pro-upgrade
  // flow), not the campaign story. Returns null when the campaign has no
  // website/bio yet.
  async getBioForCampaign(campaignId: number): Promise<string | null> {
    const website = await this.model.findUnique({ where: { campaignId } })
    return website?.content?.about?.bio ?? null
  }

  // Full persisted content for the campaign's website; null when none exists.
  async getContentForCampaign(
    campaignId: number,
  ): Promise<PrismaJson.WebsiteContent | null> {
    const website = await this.model.findUnique({ where: { campaignId } })
    return website?.content ?? null
  }

  async findByDomainName(domainName: string, include?: Prisma.WebsiteInclude) {
    const domainRecord = await this.client.domain.findUniqueOrThrow({
      where: { name: domainName },
      include: {
        website: {
          include,
        },
      },
    })

    return domainRecord.website
  }

  async getWebsiteIdByDomain(domainName: string) {
    const { websiteId } = await this.client.domain.findUniqueOrThrow({
      where: { name: domainName },
    })
    return websiteId
  }

  async verifyLive(campaignId: number): Promise<VerifyLiveResponse> {
    const website = await this.client.website.findUnique({
      where: { campaignId },
      include: {
        domain: true,
        campaign: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })

    if (!website) {
      throw new NotFoundException('No website found for this campaign')
    }
    if (!website.domain) {
      throw new BadRequestException(
        'verify-live requires an attached domain. Purchase a domain first.',
      )
    }

    const url = `https://${website.domain.name}/`

    // On dev, the candidate's vanity site isn't actually attached to the dev
    // Vercel project — the domain DNS resolves to a generic GP placeholder
    // page that lacks the privacy/terms/identity markers verify-live looks for.
    // Short-circuit so the rest of the compliance flow (TCR submission) is
    // testable in dev.
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return {
        verified: true,
        url,
        reason: null,
        checks: {
          http_200: true,
          has_privacy_policy: true,
          has_terms: true,
          has_candidate_identity: true,
        },
      }
    }

    await assertPublicHostname(website.domain.name)
    const fetched = await fetchLiveHtml(url)
    const user = website.campaign?.user
    const candidateName = user
      ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
      : null

    const result = scoreLiveHtml(url, fetched, candidateName)
    if (!result.verified) {
      this.logger.warn(
        {
          url,
          reason: result.reason,
          status: fetched.status,
          fetchError: fetched.errorCode,
          checks: result.checks,
        },
        'verify-live did not pass',
      )
    }
    return result
  }
}

type LiveFetchResult = {
  status: number
  body: string | null
  errorCode: string | null
}

export const isPublicAddress = (address: string): boolean => {
  if (ipaddr.IPv6.isValid(address)) {
    const v6 = ipaddr.IPv6.parse(address)
    return v6.isIPv4MappedAddress()
      ? v6.toIPv4Address().range() === 'unicast'
      : v6.range() === 'unicast'
  }
  if (ipaddr.IPv4.isValid(address)) {
    return ipaddr.IPv4.parse(address).range() === 'unicast'
  }
  return false
}

export const assertPublicHostname = async (hostname: string): Promise<void> => {
  const addresses = await dnsLookup(hostname, { all: true }).catch(
    () => [] as dns.LookupAddress[],
  )
  if (addresses.length === 0) {
    return
  }
  const offending = addresses.find(({ address }) => !isPublicAddress(address))
  if (offending) {
    throw new BadRequestException(
      `${hostname} resolves to a non-public IP address (${offending.address})`,
    )
  }
}

export const ssrfSafeLookup: NonNullable<https.AgentOptions['lookup']> = (
  hostname,
  options,
  callback,
) => {
  const opts = typeof options === 'number' ? { family: options } : options || {}
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) {
      return callback(err, '', 0)
    }
    if (addresses.length === 0) {
      return callback(new Error(`No addresses resolved for ${hostname}`), '', 0)
    }
    const offending = addresses.find(({ address }) => !isPublicAddress(address))
    if (offending) {
      return callback(
        new Error(
          `Refusing to connect to ${hostname} — resolved to non-public IP ${offending.address}`,
        ),
        '',
        0,
      )
    }
    // Node's http/https Agent invokes lookup with `all: true` (its
    // happy-eyeballs path). In that mode the callback contract is the array
    // form `(err, LookupAddress[])` — returning the single-address form makes
    // Node read `.address` off a string and throw ERR_INVALID_IP_ADDRESS,
    // which silently fails every verify-live fetch in prod. Echo the shape.
    if (typeof options === 'object' && options?.all) {
      return callback(null, addresses)
    }
    const first = addresses[0]
    if (!first) {
      return callback(new Error(`No addresses resolved for ${hostname}`), '', 0)
    }
    callback(null, first.address, first.family)
  })
}

const fetchLiveHtml = async (url: string): Promise<LiveFetchResult> => {
  try {
    const res = await axios.get<string>(url, {
      timeout: 10_000,
      responseType: 'text',
      validateStatus: () => true,
      maxRedirects: 5,
      transformResponse: [(data: string) => data],
      httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
      httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
    })
    const body = typeof res.data === 'string' ? res.data : null
    return { status: res.status, body, errorCode: null }
  } catch (error) {
    const errorCode =
      error instanceof AxiosError
        ? (error.code ?? error.message)
        : error instanceof Error
          ? error.message
          : 'unknown'
    return { status: 0, body: null, errorCode }
  }
}

// Marker strings are best-effort defaults pending the Peerly spec owner's
// confirmation of the exact required sections (see ENG-10258).
const PRIVACY_POLICY_PATTERN = /privacy policy/i
const TERMS_PATTERN = /terms of service|sms terms|terms and conditions/i

const scoreLiveHtml = (
  url: string,
  fetched: LiveFetchResult,
  candidateName: string | null,
): VerifyLiveResponse => {
  const http200 = fetched.status === 200
  const body = fetched.body ?? ''

  const hasPrivacyPolicy = http200 && PRIVACY_POLICY_PATTERN.test(body)
  const hasTerms = http200 && TERMS_PATTERN.test(body)
  const hasCandidateIdentity =
    http200 &&
    candidateName !== null &&
    candidateName.trim().length > 0 &&
    body.toLowerCase().includes(candidateName.trim().toLowerCase())

  const verified =
    http200 && hasPrivacyPolicy && hasTerms && hasCandidateIdentity

  // A redirect loop lands status 0, but the server IS reachable — it's a
  // misconfiguration that waiting will never fix, so it gets its own reason the
  // agent routes to an unrecoverable blocker rather than to wait_dns_propagation
  // (unreachable) or an indefinite wait_vercel_verify. axios surfaces this via
  // follow-redirects' code ERR_FR_TOO_MANY_REDIRECTS (not ERR_TOO_MANY_REDIRECTS).
  const reason = verified
    ? null
    : fetched.errorCode === 'ERR_FR_TOO_MANY_REDIRECTS'
      ? VerifyLiveReason.redirectLoop
      : fetched.status === 0
        ? VerifyLiveReason.unreachable
        : !http200
          ? VerifyLiveReason.notLive
          : VerifyLiveReason.contentMissing

  return {
    verified,
    url,
    reason,
    checks: {
      http_200: http200,
      has_privacy_policy: hasPrivacyPolicy,
      has_terms: hasTerms,
      has_candidate_identity: hasCandidateIdentity,
    },
  }
}
