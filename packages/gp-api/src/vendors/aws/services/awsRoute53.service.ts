import { Injectable, BadRequestException } from '@nestjs/common'
import {
  Route53DomainsClient,
  CheckDomainAvailabilityCommand,
  GetDomainSuggestionsCommand,
  ListPricesCommand,
  Route53DomainsServiceException,
} from '@aws-sdk/client-route-53-domains'
import { AwsService } from './aws.service'
import { PinoLogger } from 'nestjs-pino'
import { RETRY_MODES } from '@smithy/core/retry'

const AWS_ROUTE_53_REGION = 'us-east-1'

// Route53 Domains throttles account-wide at a very low rate. The SDK default
// (standard mode, 3 attempts, ~1s of backoff) can't ride out a drained token
// bucket, which chronically 502'd /domains/purchase right after the search
// fanout. Adaptive mode adds a client-side rate limiter shared across this
// singleton, so concurrent calls self-pace instead of racing into throttles.
const ROUTE_53_DOMAINS_MAX_ATTEMPTS = 8

@Injectable()
export class AwsRoute53Service extends AwsService {
  private readonly domainsClient: Route53DomainsClient

  constructor(protected readonly logger: PinoLogger) {
    super(logger)
    this.domainsClient = new Route53DomainsClient({
      region: AWS_ROUTE_53_REGION,
      retryMode: RETRY_MODES.ADAPTIVE,
      maxAttempts: ROUTE_53_DOMAINS_MAX_ATTEMPTS,
    })
  }

  /**
   * Checks if a domain name is available for registration
   * @param domainName - The domain name to check (e.g. 'example.com')
   * @see {@link https://docs.aws.amazon.com/Route53/latest/APIReference/API_domains_CheckDomainAvailability.html}
   */
  async checkDomainAvailability(domainName: string) {
    return this.executeAwsOperation(async () => {
      const command = new CheckDomainAvailabilityCommand({
        DomainName: domainName,
      })
      const result = await this.domainsClient.send(command)

      if (result instanceof Route53DomainsServiceException) {
        switch (result.name) {
          case 'InvalidInput':
          case 'UnsupportedTLD':
            throw new BadRequestException(result.message)
          default:
            throw result
        }
      }

      return result
    })
  }

  /**
   * Gets domain name suggestions based on a search term
   * @param domainName - The domain name to get suggestions for (e.g. 'example')
   * @param suggestionCount - Number of suggestions to return (default: 10, max: 50)
   * @param onlyAvailable - Whether to return only available domains (default: true)
   * @returns List of domain suggestions with availability and pricing
   * @see {@link https://docs.aws.amazon.com/Route53/latest/APIReference/API_domains_GetDomainSuggestions.html}
   */
  async getDomainSuggestions(
    domainName: string,
    suggestionCount: number = 10,
    onlyAvailable: boolean = true,
  ) {
    return this.executeAwsOperation(async () => {
      const command = new GetDomainSuggestionsCommand({
        DomainName: domainName,
        SuggestionCount: Math.min(suggestionCount, 50), // AWS max is 50
        OnlyAvailable: onlyAvailable,
      })
      const result = await this.domainsClient.send(command)

      if (result instanceof Route53DomainsServiceException) {
        switch (result.name) {
          case 'InvalidInput':
          case 'UnsupportedTLD':
            throw new BadRequestException(result.message)
          default:
            throw result
        }
      }

      return result
    })
  }

  /**
   * Lists domain registration prices, optionally filtered by TLD
   * @param tld - Optional TLD to filter prices for (e.g. 'com', 'net', etc.)
   * @returns List of domain prices
   * @see {@link https://docs.aws.amazon.com/Route53/latest/APIReference/API_domains_ListPrices.html}
   */
  async listPrices(tld?: string) {
    return this.executeAwsOperation(async () => {
      const command = new ListPricesCommand({
        MaxItems: 1000,
        Tld: tld,
      })
      const result = await this.domainsClient.send(command)

      if (result instanceof Route53DomainsServiceException) {
        switch (result.name) {
          case 'InvalidInput':
          case 'UnsupportedTLD':
            throw new BadRequestException(result.message)
          default:
            throw result
        }
      }

      return result
    })
  }
}
