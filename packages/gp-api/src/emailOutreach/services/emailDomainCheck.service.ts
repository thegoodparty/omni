import { Injectable } from '@nestjs/common'
import { Resolver } from 'node:dns/promises'
import pMap from 'p-map'

const DNS_TIMEOUT_MS = 3000
const DNS_CONCURRENCY = 20

const dnsCode = (err: Error): string | undefined =>
  'code' in err && typeof err.code === 'string' ? err.code : undefined

@Injectable()
export class EmailDomainCheckService {
  private readonly resolver = new Resolver({
    timeout: DNS_TIMEOUT_MS,
    tries: 2,
  })

  async findUndeliverableDomains(domains: string[]): Promise<Set<string>> {
    const unique = [...new Set(domains)]
    const results = await pMap(
      unique,
      async (domain) => ({ domain, ok: await this.isDeliverable(domain) }),
      { concurrency: DNS_CONCURRENCY },
    )
    return new Set(results.filter((r) => !r.ok).map((r) => r.domain))
  }

  // Invalid only on NXDOMAIN, or when the domain has neither an MX nor an A
  // record. SERVFAIL and timeouts are the resolver's problem, not the
  // address's, so they count as valid.
  private async isDeliverable(domain: string): Promise<boolean> {
    try {
      if ((await this.resolver.resolveMx(domain)).length > 0) return true
    } catch (err) {
      const code = err instanceof Error ? dnsCode(err) : undefined
      if (code === 'ENOTFOUND') return false
      if (code !== 'ENODATA') return true
    }
    try {
      return (await this.resolver.resolve4(domain)).length > 0
    } catch (err) {
      const code = err instanceof Error ? dnsCode(err) : undefined
      return code !== 'ENOTFOUND' && code !== 'ENODATA'
    }
  }
}
