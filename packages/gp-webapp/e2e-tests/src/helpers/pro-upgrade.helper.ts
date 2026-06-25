import type { AxiosInstance } from 'axios'

// Seed helpers for the pre-payment Pro-upgrade wizard. These write the same
// canonical state the wizard steps persist, hitting the same gp-api endpoints,
// so `deriveProUpgradeStep` (app/dashboard/pro-upgrade/proUpgradeStep.ts)
// resolves the resume step from real persisted state — not from anything faked.
//
// Live in src/helpers/ (not app/) per e2e-tests/CLAUDE.md: this dir is a
// separate workspace with no Next runtime, so it must not import app code.

// A shape-valid, sanity-passing EIN (prefix 47 is an IRS-issued prefix; not a
// placeholder / all-same-digit value), so `checkEinSanity` treats it as a real
// EIN and the derivation counts the EIN step as complete.
export const SEED_VALID_EIN = '47-1234567'

// Seed the EIN step's persisted output plus the filing-status answer.
//
// The EIN step itself only writes `details.einNumber` / `details.validatedEin`
// (EinStep.tsx -> updateCampaign -> PUT /v1/campaigns/mine). But reaching the
// EIN step at all requires the filing-status question to have been answered
// "yes, already filed" first (it persists `details.hasFiledForRace`), otherwise
// `deriveProUpgradeStep` routes a candidate with progress to the STATUS step,
// not a data step. So an honest "EIN-only" resume seed must also set
// hasFiledForRace=true — that answer is a real upstream prerequisite of the EIN
// step, not a shortcut.
export const seedEinAndFiled = async (client: AxiosInstance): Promise<void> => {
  await client.put('/v1/campaigns/mine', {
    details: {
      einNumber: SEED_VALID_EIN,
      validatedEin: true,
      hasFiledForRace: true,
    },
  })
}

// Seed the filing-details step's persisted output by submitting the TCR
// registration through the same endpoint the step uses (FilingDetailsStep.tsx
// -> submitTcrCompliance -> POST /v1/campaigns/tcr-compliance/agentic). The
// created record defaults to `submitted`, which `getTcrComplianceStatusCompletions`
// counts as `filingComplete`, advancing the derived resume step past
// filing-details. Non-federal payload (CANDIDATE committee, no FEC id) — the
// seeded campaign runs for a local office (Cheyenne City Council, the
// authenticateTestUser default), which maps to officeLevel `local`.
export const seedFilingComplete = async (
  client: AxiosInstance,
  email: string,
): Promise<void> => {
  await client.post('/v1/campaigns/tcr-compliance/agentic', {
    ein: SEED_VALID_EIN,
    placeId: 'ChIJ-seed-place-id',
    formattedAddress: '123 Capitol Ave, Cheyenne, WY 82001, USA',
    committeeName: 'Jane for Council',
    // tcrComplianceBaseShape requires a filing URL that includes a path.
    filingUrl: 'https://sos.wyo.gov/filing/jane-for-council',
    email,
    phone: '+13075551234',
    officeLevel: 'local',
    committeeType: 'CANDIDATE',
  })
}
