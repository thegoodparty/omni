// SSRF guards, kept free of app-env imports. Importers (chat attachments, the
// judging CLI graph) must not pull in websites.service, whose appEnvironment
// import validates required env vars at module load.
import { BadRequestException } from '@nestjs/common'
import * as dns from 'node:dns'
import * as https from 'node:https'
import { promisify } from 'node:util'
import ipaddr from 'ipaddr.js'

const dnsLookup = promisify(dns.lookup)

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
