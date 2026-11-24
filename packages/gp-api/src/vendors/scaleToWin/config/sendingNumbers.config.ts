// Our own Bandwidth 10DLC sending numbers in the prod subaccount, read from
// its Phone Numbers page on 2026-11-24. The API can't list numbers, so this
// list is maintained by hand (see ../AGENTS.md).
export const sendingNumberByState: Readonly<Record<string, string>> = {
  AL: '+19382049132',
  AR: '+18707055416',
  AZ: '+16028301729',
  CA: '+12136853930',
  CO: '+19705520102',
  FL: '+18505476852',
  GA: '+17063090716',
  IN: '+15742816467',
  KY: '+18594745574',
  LA: '+12255001947',
  MA: '+16172214983',
  MD: '+14438080882',
  ME: '+12072488496',
  MI: '+15172256295',
  MN: '+16122388359',
  NC: '+19109060305',
  NE: '+14029253004',
  NJ: '+19736586331',
  NM: '+15752864785',
  NV: '+17759810736',
  OH: '+15132989629',
  OK: '+15722052553',
  OR: '+15414065553',
  RI: '+14012970682',
  SC: '+18439837579',
  TN: '+16159890614',
  TX: '+19036509004',
  VA: '+18048186315',
  WA: '+12067389752',
  WY: '+13072159085',
}

const MICHIGAN_DETROIT = '+13132038028'

// Detroit-area offices whose past waves went out on the Detroit number.
export const sendingNumberByOrganizationSlug: Readonly<Record<string, string>> =
  {
    // Dearborn City Council
    'eo-019a7e76-c70b-73a1-ae4b-8b3e2f2cd851': MICHIGAN_DETROIT,
    // Oak Park School Board
    'eo-01a1c5ef-6cd8-77e3-aade-1fc3cf8b3038': MICHIGAN_DETROIT,
    // Taylor City Council
    'eo-01a03e2b-77e8-72e3-b0a8-720d5ae26c4d': MICHIGAN_DETROIT,
  }

export const tollFreeFallback = '+18334237349'

export const resolveSendingNumber = ({
  organizationSlug,
  state,
}: {
  organizationSlug: string
  state: string | null
}): string =>
  sendingNumberByOrganizationSlug[organizationSlug] ??
  (state ? sendingNumberByState[state] : undefined) ??
  tollFreeFallback
