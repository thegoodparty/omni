import { Resolver } from 'node:dns/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailDomainCheckService } from './emailDomainCheck.service'

const dnsError = (code: string): Error =>
  Object.assign(new Error(code), { code })

const mx = (exchange = 'mx.example.com') => [{ exchange, priority: 10 }]

describe('EmailDomainCheckService', () => {
  const service = new EmailDomainCheckService()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const check = (domain = 'example.com') =>
    service.findUndeliverableDomains([domain])

  it('accepts a domain with an MX record', async () => {
    vi.spyOn(Resolver.prototype, 'resolveMx').mockResolvedValue(mx())
    expect((await check()).size).toBe(0)
  })

  it('rejects NXDOMAIN', async () => {
    vi.spyOn(Resolver.prototype, 'resolveMx').mockRejectedValue(
      dnsError('ENOTFOUND'),
    )
    expect([...(await check('nope.test'))]).toEqual(['nope.test'])
  })

  it('rejects a domain with no MX and no A record', async () => {
    vi.spyOn(Resolver.prototype, 'resolveMx').mockRejectedValue(
      dnsError('ENODATA'),
    )
    vi.spyOn(Resolver.prototype, 'resolve4').mockRejectedValue(
      dnsError('ENODATA'),
    )
    expect((await check()).size).toBe(1)
  })

  it('accepts a domain with no MX but an A record', async () => {
    vi.spyOn(Resolver.prototype, 'resolveMx').mockRejectedValue(
      dnsError('ENODATA'),
    )
    vi.spyOn(Resolver.prototype, 'resolve4').mockResolvedValue(['192.0.2.1'])
    expect((await check()).size).toBe(0)
  })

  it.each(['ESERVFAIL', 'ETIMEOUT'])('treats %s as valid', async (code) => {
    vi.spyOn(Resolver.prototype, 'resolveMx').mockRejectedValue(dnsError(code))
    expect((await check()).size).toBe(0)
  })

  it('looks each domain up once', async () => {
    const resolveMx = vi
      .spyOn(Resolver.prototype, 'resolveMx')
      .mockResolvedValue(mx())
    await service.findUndeliverableDomains(['a.com', 'a.com', 'b.com', 'a.com'])
    expect(resolveMx).toHaveBeenCalledTimes(2)
  })
})
