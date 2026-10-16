import {
  BadGatewayException,
  BadRequestException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Vercel } from '@vercel/sdk'
import type {
  GetRecordsResponseBody,
  Records as VercelDNSRecord,
} from '@vercel/sdk/models/getrecordsop'
import { ForwardEmailDomainResponse } from '../../forwardEmail/forwardEmail.types'
import { NotFound } from '@vercel/sdk/models/notfound'
import { VercelError } from '@vercel/sdk/models/vercelerror'
import { parsePhoneNumberWithError } from 'libphonenumber-js'
import { PinoLogger } from 'nestjs-pino'
import { resolveEnvVar } from '../../../shared/env/env'

const VERCEL_NOT_CONFIGURED_MESSAGE =
  'Candidate domains are disabled: set VERCEL_TOKEN and VERCEL_PROJECT_ID'

type VercelConfig = {
  token: string
  projectId: string
  teamId: string | undefined
}

const resolveVercelConfig = (): VercelConfig | null => {
  const token = resolveEnvVar('VERCEL_TOKEN')
  const projectId = resolveEnvVar('VERCEL_PROJECT_ID')
  if (!token.configured || !projectId.configured) {
    return null
  }
  return {
    token: token.value,
    projectId: projectId.value,
    teamId: process.env.VERCEL_TEAM_ID,
  }
}

const vercelConfig = resolveVercelConfig()
const vercelClient = vercelConfig
  ? new Vercel({ bearerToken: vercelConfig.token })
  : null

export const FORWARDEMAIL_MX1_VALUE = 'mx1.forwardemail.net'
export const FORWARDEMAIL_MX2_VALUE = 'mx2.forwardemail.net'
export const FORWARDEMAIL_TXT_VALUE_PREFIX = 'forward-email-site-verification='

export enum VercelDnsRecordType {
  Mx = 'MX',
  Txt = 'TXT',
}

export type DNSRecord = { uid: string; updated?: number }

@Injectable()
export class VercelService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(VercelService.name)
    if (!vercelConfig) {
      this.logger.warn(VERCEL_NOT_CONFIGURED_MESSAGE)
    }
  }

  // Candidate domains degrade to a consistent 400 rather than crashing boot
  // when Vercel isn't configured — resolved once at module load, not per call.
  private requireClient(): {
    client: Vercel
    projectId: string
    teamId: string | undefined
  } {
    if (!vercelClient || !vercelConfig) {
      throw new BadRequestException(VERCEL_NOT_CONFIGURED_MESSAGE)
    }
    return {
      client: vercelClient,
      projectId: vercelConfig.projectId,
      teamId: vercelConfig.teamId,
    }
  }

  isVercelNotFoundError(e: unknown): e is NotFound {
    return (
      e instanceof NotFound ||
      (e instanceof VercelError &&
        e.statusCode === Number(HttpStatus.NOT_FOUND))
    )
  }

  isVercelTransientError(e: unknown): boolean {
    return (
      e instanceof VercelError &&
      (e.statusCode >= 500 ||
        e.statusCode === Number(HttpStatus.TOO_MANY_REQUESTS))
    )
  }

  async getProjectDomain(domainName: string) {
    const { client, projectId, teamId } = this.requireClient()
    try {
      return await client.projects.getProjectDomain({
        idOrName: projectId,
        domain: domainName,
        teamId,
      })
    } catch (error) {
      this.logger.error({ error }, `Error getting domain ${domainName}:`)
      throw error
    }
  }

  async addDomainToProject(domainName: string) {
    const { client, projectId, teamId } = this.requireClient()
    try {
      return await client.projects.addProjectDomain({
        idOrName: projectId,
        teamId,
        requestBody: {
          name: domainName,
        },
      })
    } catch (error) {
      this.logger.error(
        { error },
        `Error adding domain ${domainName} to project:`,
      )
      throw error
    }
  }

  async removeDomainFromProject(domainName: string) {
    const { client, projectId, teamId } = this.requireClient()
    try {
      return await client.projects.removeProjectDomain({
        idOrName: projectId,
        domain: domainName,
        teamId,
      })
    } catch (error) {
      this.logger.error(
        { error },
        `Error removing domain ${domainName} from project:`,
      )
      throw error
    }
  }

  async verifyProjectDomain(domainName: string) {
    const { client, projectId, teamId } = this.requireClient()
    try {
      return await client.projects.verifyProjectDomain({
        idOrName: projectId,
        domain: domainName,
        teamId,
      })
    } catch (error) {
      this.logger.error({ error }, `Error verifying domain ${domainName}:`)
      throw error
    }
  }

  /**
   * Check the price for a domain
   * @see https://vercel.com/docs/domains/registrar-api
   */
  async checkDomainPrice(domainName: string): Promise<{ price: number }> {
    const { client, teamId } = this.requireClient()
    try {
      const result = await client.domainsRegistrar.getDomainPrice({
        domain: domainName,
        teamId,
      })

      this.logger.debug(result, `Price check for ${domainName}:`)

      if (result.purchasePrice === null || result.purchasePrice === undefined) {
        throw new Error(
          `Domain ${domainName} is not available for purchase or price unavailable`,
        )
      }

      const price =
        typeof result.purchasePrice === 'string'
          ? parseFloat(result.purchasePrice)
          : result.purchasePrice

      return { price }
    } catch (error) {
      this.logger.error(
        { error },
        `Error checking price for domain ${domainName}:`,
      )
      throw error
    }
  }

  /**
   * Purchase a domain through Vercel
   * @param domainName - The domain name to purchase (e.g. 'example.com')
   * @param contact - Contact information for domain registration
   * @param expectedPrice - The expected price for the domain
   * @param autoRenew - Whether to auto-renew the domain (defaults to true)
   * @param years - Number of years to purchase the domain for (defaults to 1)
   * @returns Operation result from Vercel
   */
  async purchaseDomain(
    domainName: string,
    contact: {
      firstName: string
      lastName: string
      email: string
      phoneNumber: string
      addressLine1: string
      addressLine2?: string
      city: string
      state: string
      zipCode: string
    },
    expectedPrice: number,
    autoRenew: boolean = true,
    years: number = 1,
  ) {
    const { client, teamId } = this.requireClient()
    try {
      this.logger.debug(`Purchasing domain ${domainName} through Vercel`)

      let formattedPhone: string
      try {
        const phoneNumber = parsePhoneNumberWithError(contact.phoneNumber, 'US')
        formattedPhone = phoneNumber.format('E.164')
        this.logger.debug(`Formatted phone number: ${formattedPhone}`)
      } catch (phoneError) {
        this.logger.error(
          { phoneError },
          `Error formatting phone number ${contact.phoneNumber}:`,
        )
        throw new Error(
          `Invalid phone number format: ${contact.phoneNumber}. Must be a valid US phone number.`,
        )
      }

      const result = await client.domainsRegistrar.buySingleDomain({
        domain: domainName.trim(),
        teamId,
        requestBody: {
          autoRenew,
          years,
          expectedPrice,
          contactInformation: {
            firstName: contact.firstName.trim(),
            lastName: contact.lastName.trim(),
            email: contact.email.trim(),
            phone: formattedPhone,
            address1: contact.addressLine1.trim(),
            ...(contact.addressLine2?.trim()
              ? { address2: contact.addressLine2.trim() }
              : {}),
            city: contact.city.trim(),
            state: contact.state.trim(),
            zip: contact.zipCode.trim(),
            country: 'US',
          },
        },
      })

      this.logger.debug(result, `Domain purchase result for ${domainName}:`)
      return result
    } catch (error) {
      this.logger.error({ error }, `Error purchasing domain ${domainName}:`)
      throw error
    }
  }

  async getRegistrarOrder(orderId: string) {
    const { client, teamId } = this.requireClient()
    try {
      return await client.domainsRegistrar.getOrder({
        orderId,
        teamId,
      })
    } catch (error) {
      this.logger.error({ error }, `Error getting registrar order ${orderId}:`)
      throw error
    }
  }

  /**
   * Retrieve the EPP/auth code a registrant needs to transfer a domain away
   * from Vercel to another registrar.
   * @see https://vercel.com/docs/domains/registrar-api
   */
  async getDomainAuthCode(domainName: string): Promise<string> {
    const { client, teamId } = this.requireClient()
    try {
      const { authCode } = await client.domainsRegistrar.getDomainAuthCode({
        domain: domainName,
        teamId,
      })

      // The SDK's inbound schema coerces a null or absent authCode to '' and
      // still types it as string, so a partial 200 would hand support an empty
      // credential that only fails later, at the candidate's new registrar.
      if (!authCode) {
        throw new BadGatewayException(
          `Vercel returned an empty auth code for domain ${domainName}`,
        )
      }

      return authCode
    } catch (error) {
      // Unlike the sibling methods, never log the success payload — the auth
      // code is a bearer credential for taking the domain off our account.
      this.logger.error(
        { error },
        `Error getting auth code for domain ${domainName}:`,
      )
      throw error
    }
  }

  async getDomainDetails(domainName: string) {
    const { client, teamId } = this.requireClient()
    try {
      return await client.domains.getDomain({
        domain: domainName,
        teamId,
      })
    } catch (error) {
      this.logger.error(
        { error },
        `Error getting domain details for ${domainName}:`,
      )
      throw error
    }
  }

  async listDomains() {
    const { client, teamId } = this.requireClient()
    try {
      return await client.domains.getDomains({
        teamId,
      })
    } catch (error) {
      this.logger.error({ error }, 'Error listing domains:')
      throw error
    }
  }

  async listDnsRecords(domainName: string): Promise<VercelDNSRecord[]> {
    const { client, teamId } = this.requireClient()
    try {
      const all: VercelDNSRecord[] = []
      const limit = '100'
      let since: string | null = null
      let hasMore = true
      let backoff = 250
      const maxBackoff = 4000
      while (hasMore) {
        const res = await client.dns.getRecords({
          domain: domainName,
          teamId,
          limit,
          ...(since ? { since } : {}),
        })
        if (typeof res === 'string') {
          this.logger.error(
            `Error listing DNS records for ${domainName}: ${res}`,
          )
          return []
        }
        const page = res as GetRecordsResponseBody
        // Vercel API pagination/records are untyped — SDK does not expose typed page structure
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const records = (page as { records: VercelDNSRecord[] }).records ?? []
        all.push(...records)
        const nextTs =
          // Vercel API pagination/records are untyped — SDK does not expose typed page structure
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (page as { pagination?: { next?: number | null } }).pagination
            ?.next ?? null
        hasMore = Boolean(nextTs)
        since = nextTs ? String(nextTs) : null
        if (hasMore) {
          await new Promise((r) => setTimeout(r, backoff))
          backoff = Math.min(backoff * 2, maxBackoff)
        }
      }
      return all
    } catch (error) {
      this.logger.error(
        { error },
        `Error listing DNS records for ${domainName}:`,
      )
      throw error
    }
  }

  async createMXRecords(domain: string): Promise<DNSRecord[]> {
    const { client, teamId } = this.requireClient()
    try {
      const mx1 = await client.dns.createRecord({
        domain,
        teamId,
        requestBody: {
          type: VercelDnsRecordType.Mx,
          name: '',
          value: FORWARDEMAIL_MX1_VALUE,
          mxPriority: 10,
          ttl: 60,
        },
      })

      const mx2 = await client.dns.createRecord({
        domain,
        teamId,
        requestBody: {
          type: VercelDnsRecordType.Mx,
          name: '',
          value: FORWARDEMAIL_MX2_VALUE,
          mxPriority: 10,
          ttl: 60,
        },
      })

      return [mx1, mx2].filter((r): r is DNSRecord =>
        Boolean((r as DNSRecord).uid),
      )
    } catch (error) {
      this.logger.error({ error }, `Error creating MX records for ${domain}:`)
      throw error
    }
  }

  async createTXTVerificationRecord(
    domain: string,
    forwardingDomainResponse: ForwardEmailDomainResponse,
  ): Promise<DNSRecord> {
    const { client, teamId } = this.requireClient()
    try {
      const res = await client.dns.createRecord({
        domain,
        teamId,
        requestBody: {
          type: VercelDnsRecordType.Txt,
          name: '',
          value: `${FORWARDEMAIL_TXT_VALUE_PREFIX}${forwardingDomainResponse.verification_record}`,
          ttl: 60,
        },
      })
      return res as DNSRecord
    } catch (error) {
      this.logger.error({ error }, `Error creating SPF record for ${domain}:`)
      throw error
    }
  }
}
