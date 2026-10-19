import type { AxiosInstance } from 'axios'

// Seed helpers for the pre-payment Pro-upgrade wizard. These write the same
// canonical state the wizard steps persist, hitting the same gp-api endpoints,
// so the steps prefill from real persisted state — not from anything faked.
//
// Live in src/helpers/ (not app/) per e2e-tests/CLAUDE.md: this dir is a
// separate workspace with no Next runtime, so it must not import app code.

// A shape-valid, sanity-passing EIN (prefix 47 is an IRS-issued prefix; not a
// placeholder / all-same-digit value), so `checkEinSanity` treats it as a real
// EIN and the EIN step prefills with it.
export const SEED_VALID_EIN = '47-1234567'

// Seed the EIN step's persisted output plus the filing-status answer.
//
// The EIN step itself only writes `details.einNumber` / `details.validatedEin`
// (EinStep.tsx -> updateCampaign -> PUT /v1/campaigns/mine). The filing-status
// step before it persists `details.hasFiledForRace`, which the wizard prefills
// from, so an honest "EIN-only" seed sets it too: that answer is a real
// upstream prerequisite of the EIN step, not a shortcut.
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
// counts as `filingComplete`, so the filing-details step shows its saved state. Non-federal payload (CANDIDATE committee, no FEC id) — the
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
    candidateName: 'Jane Smith',
    // tcrComplianceBaseShape requires a filing URL that includes a path.
    filingUrl: 'https://sos.wyo.gov/filing/jane-for-council',
    email,
    phone: '+13075551234',
    officeLevel: 'local',
    committeeType: 'CANDIDATE',
  })
}

// ≥500 plain chars and free of the compliance fallback-template marker, so
// isGenuineBioPlainText accepts it (the completeness gate the wizard's
// candidate profile form enforces).
const SEED_GENUINE_BIO =
  'I am running for City Council because our neighborhood deserves a ' +
  'representative who shows up, listens, and follows through. For years I ' +
  'have organized with neighbors on the issues that touch daily life: safe ' +
  'streets, reliable services, affordable housing, and an open, accountable ' +
  'local government. I will bring that same energy to the council, fighting ' +
  'for transparent budgets, smart infrastructure investment, and a city ' +
  'that works for working families rather than the well-connected few. ' +
  'Together we can build a community we are all proud to call home, today ' +
  'and for the generations that follow us.'

// Seed the candidate profile's persisted output — the same
// `website.content.about` slice `saveAboutFields` writes (bio + one genuine
// policy priority) — so `isCandidateProfileComplete` passes. GET /v1/websites/mine returns
// null (200) when the campaign has no website yet; create it first then, the
// same order saveAboutFields uses.
export const seedCandidateProfileComplete = async (
  client: AxiosInstance,
): Promise<void> => {
  const { data: website } = await client.get<{ id?: number } | null>(
    '/v1/websites/mine',
  )
  if (!website) {
    await client.post('/v1/websites', {})
  }
  await client.put('/v1/websites/mine', {
    about: {
      bio: SEED_GENUINE_BIO,
      issues: [
        {
          title: 'Safe and affordable housing',
          description:
            'Expand affordable housing by streamlining permits, protecting ' +
            'renters from unfair increases, and partnering with builders ' +
            'on starter homes.',
        },
      ],
    },
  })
}
