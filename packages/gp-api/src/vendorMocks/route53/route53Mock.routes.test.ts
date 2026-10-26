import {
  CheckDomainAvailabilityCommand,
  GetDomainSuggestionsCommand,
  ListPricesCommand,
  Route53DomainsClient,
} from '@aws-sdk/client-route-53-domains'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService()
const PATH = '/v1/vendor-mocks/route53'
const AWS_JSON = 'application/x-amz-json-1.1'

const post = (target: string, body: unknown) =>
  service.client.post(PATH, JSON.stringify(body), {
    headers: { 'Content-Type': AWS_JSON, 'X-Amz-Target': target },
  })

const buildClient = () =>
  new Route53DomainsClient({
    region: 'us-east-1',
    endpoint: `${service.client.defaults.baseURL}${PATH}`,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  })

describe('POST /v1/vendor-mocks/route53', () => {
  beforeEach(() => {
    appEnvOverrides.VENDOR_MODE = 'mock'
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const res = await post('Route53Domains_v20140515.ListPrices', {})
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 501 for an unknown target', async () => {
    const res = await post('Route53Domains_v20140515.RegisterDomain', {})
    expect(res.status).toBe(HttpStatus.NOT_IMPLEMENTED)
  })

  it('returns 501 when the target header is missing', async () => {
    const res = await service.client.post(PATH, '{}', {
      headers: { 'Content-Type': AWS_JSON },
    })
    expect(res.status).toBe(HttpStatus.NOT_IMPLEMENTED)
  })

  it('returns 400 for malformed JSON and missing DomainName', async () => {
    const bad = await service.client.post(PATH, '{nope', {
      headers: {
        'Content-Type': AWS_JSON,
        'X-Amz-Target': 'Route53Domains_v20140515.CheckDomainAvailability',
      },
    })
    expect(bad.status).toBe(HttpStatus.BAD_REQUEST)
    const missing = await post(
      'Route53Domains_v20140515.CheckDomainAvailability',
      {},
    )
    expect(missing.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('responds with the AWS JSON 1.1 content type', async () => {
    const res = await post('Route53Domains_v20140515.CheckDomainAvailability', {
      DomainName: 'a.com',
    })
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.headers['content-type']).toContain(AWS_JSON)
  })

  describe('with the AWS SDK client', () => {
    it('CheckDomainAvailability', async () => {
      const client = buildClient()
      const ok = await client.send(
        new CheckDomainAvailabilityCommand({
          DomainName: 'example-candidate.com',
        }),
      )
      expect(ok.Availability).toBe('AVAILABLE')
      const taken = await client.send(
        new CheckDomainAvailabilityCommand({ DomainName: 'taken-x.com' }),
      )
      expect(taken.Availability).toBe('UNAVAILABLE')
    })

    it('GetDomainSuggestions returns 3 available suggestions', async () => {
      const res = await buildClient().send(
        new GetDomainSuggestionsCommand({
          DomainName: 'jane.run',
          SuggestionCount: 10,
          OnlyAvailable: true,
        }),
      )
      expect(res.SuggestionsList).toHaveLength(3)
      for (const s of res.SuggestionsList ?? []) {
        expect(s.Availability).toBe('AVAILABLE')
        expect(s.DomainName).toMatch(/jane\.run$/)
      }
    })

    it('ListPrices returns .com at 13 USD and each supported TLD', async () => {
      const res = await buildClient().send(new ListPricesCommand({}))
      const com = res.Prices?.find((p) => p.Name === 'com')
      expect(com?.RegistrationPrice).toEqual({ Price: 13, Currency: 'USD' })
      expect(com?.RenewalPrice).toEqual({ Price: 13, Currency: 'USD' })
      expect(res.Prices?.map((p) => p.Name)).toEqual(
        expect.arrayContaining(['run', 'bio', 'fyi', 'win', 'digital', 'site']),
      )
      const filtered = await buildClient().send(
        new ListPricesCommand({ Tld: 'com' }),
      )
      expect(filtered.Prices).toHaveLength(1)
    })
  })
})
