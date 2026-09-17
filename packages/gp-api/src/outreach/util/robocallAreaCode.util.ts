/**
 * Resolves the 3-digit area code to request when renting a robocall
 * caller-ID number, from the campaign's zip, so the candidate's callback
 * number looks local rather than a random national number.
 */
import { Campaign } from '../../generated/prisma'
import {
  type AreaCodeFromZipLookup,
  parseDetailsGeography,
} from './campaignGeography.util'

export interface RobocallAreaCodeLogger {
  debug: (obj: object, message: string) => void
}

export interface ResolveRobocallAreaCodeServices {
  areaCodeFromZipService: AreaCodeFromZipLookup
  logger?: RobocallAreaCodeLogger
}

/**
 * Never throws: a campaign with no zip, or a zip the lookup can't place,
 * returns undefined so CallhubNumbersService.rentNumber falls back to its
 * plain national rental rather than blocking the request over caller-ID
 * geography.
 */
export async function resolveRobocallAreaCode(
  details: Campaign['details'] | null | undefined,
  { areaCodeFromZipService, logger }: ResolveRobocallAreaCodeServices,
): Promise<string | undefined> {
  const zip = parseDetailsGeography(details)?.zip
  if (!zip) {
    logger?.debug(
      {},
      'Robocall number rental: campaign has no zip, renting a national number',
    )
    return undefined
  }

  // Strip a ZIP+4 suffix (e.g. 12345-6789 → 12345), like the P2P geography
  // lookup does — the area-code service expects a 5-digit zip.
  const normalizedZip = zip.replace(/-\d{4}$/, '')
  const areaCodes =
    await areaCodeFromZipService.getAreaCodeFromZip(normalizedZip)
  if (!areaCodes || areaCodes.length === 0) {
    logger?.debug(
      { zip: normalizedZip },
      'Robocall number rental: zip has no known area code, renting a national number',
    )
    return undefined
  }

  return areaCodes[0]
}

/**
 * Extracts the 3-digit NPA from a rented E.164 US number (+1NPANXXXXXX) so
 * the caller can detect CallHub's silent national-number fallback (it never
 * errors when the requested prefix has no inventory — see
 * callhubNumber.schema.ts) and log it instead of asserting on it.
 */
export function areaCodeFromE164UsNumber(
  phoneNumber: string,
): string | undefined {
  const match = /^\+?1?(\d{3})\d{7}$/.exec(phoneNumber)
  return match?.[1]
}
