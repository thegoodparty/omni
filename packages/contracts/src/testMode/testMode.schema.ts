import { z } from 'zod'

export const TEST_MODE_ORGANIZATION_TYPE_VALUES = [
  'campaign',
  'elected_office',
] as const
export type TestModeOrganizationType =
  (typeof TEST_MODE_ORGANIZATION_TYPE_VALUES)[number]
export const TestModeOrganizationTypeSchema = z.enum(
  TEST_MODE_ORGANIZATION_TYPE_VALUES,
)

export const TEST_MODE_FAMILY_VALUES = [
  'onboarding',
  'pro',
  'election',
  'term',
  'tenDlc',
] as const
export type TestModeFamily = (typeof TEST_MODE_FAMILY_VALUES)[number]
export const TestModeFamilySchema = z.enum(TEST_MODE_FAMILY_VALUES)

export const TEST_MODE_ONBOARDING_PRESET_VALUES = [
  'not_started',
  'complete',
] as const
export type TestModeOnboardingPreset =
  (typeof TEST_MODE_ONBOARDING_PRESET_VALUES)[number]
export const TestModeOnboardingPresetSchema = z.enum(
  TEST_MODE_ONBOARDING_PRESET_VALUES,
)

export const TEST_MODE_PRO_PRESET_VALUES = ['on', 'off'] as const
export type TestModeProPreset = (typeof TEST_MODE_PRO_PRESET_VALUES)[number]
export const TestModeProPresetSchema = z.enum(TEST_MODE_PRO_PRESET_VALUES)

export const TEST_MODE_ELECTION_PRESET_VALUES = [
  'in_8_weeks',
  'in_1_week',
  'passed_unanswered',
  'passed_won',
  'passed_lost',
] as const
export type TestModeElectionPreset =
  (typeof TEST_MODE_ELECTION_PRESET_VALUES)[number]
export const TestModeElectionPresetSchema = z.enum(
  TEST_MODE_ELECTION_PRESET_VALUES,
)

export const TEST_MODE_TERM_PRESET_VALUES = [
  'active',
  'ending_soon',
  'ended',
] as const
export type TestModeTermPreset = (typeof TEST_MODE_TERM_PRESET_VALUES)[number]
export const TestModeTermPresetSchema = z.enum(TEST_MODE_TERM_PRESET_VALUES)

export const TEST_MODE_TEN_DLC_PRESET_VALUES = [
  'none',
  'in_progress',
  'filing_hold',
  'awaiting_pin',
  'in_review',
  'approved',
  'rejected',
  'error',
] as const
export type TestModeTenDlcPreset =
  (typeof TEST_MODE_TEN_DLC_PRESET_VALUES)[number]
export const TestModeTenDlcPresetSchema = z.enum(
  TEST_MODE_TEN_DLC_PRESET_VALUES,
)

export const TestModeRaceSchema = z.object({
  zip: z.string().trim().min(1),
  office: z.string().trim().min(1),
})
export type TestModeRace = z.infer<typeof TestModeRaceSchema>

export const CreateTestOrganizationRequestSchema = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('campaign'),
      race: TestModeRaceSchema,
      onboarding: TestModeOnboardingPresetSchema,
      pro: TestModeProPresetSchema,
      election: TestModeElectionPresetSchema,
      tenDlc: TestModeTenDlcPresetSchema,
    }),
    z.object({
      type: z.literal('elected_office'),
      onboarding: TestModeOnboardingPresetSchema,
      term: TestModeTermPresetSchema,
    }),
  ],
)
export type CreateTestOrganizationRequest = z.infer<
  typeof CreateTestOrganizationRequestSchema
>

export const ApplyTestModeRequestSchema = z.discriminatedUnion('family', [
  z.object({
    family: z.literal('onboarding'),
    preset: TestModeOnboardingPresetSchema,
  }),
  z.object({ family: z.literal('pro'), preset: TestModeProPresetSchema }),
  z.object({
    family: z.literal('election'),
    preset: TestModeElectionPresetSchema,
  }),
  z.object({ family: z.literal('term'), preset: TestModeTermPresetSchema }),
  z.object({
    family: z.literal('tenDlc'),
    preset: TestModeTenDlcPresetSchema,
  }),
])
export type ApplyTestModeRequest = z.infer<typeof ApplyTestModeRequestSchema>

export const TestModeFamilyStateSchema = z.object({
  current: z.string().nullable(),
  available: z.array(z.string()),
})
export type TestModeFamilyState = z.infer<typeof TestModeFamilyStateSchema>

export const TestModeOrganizationSchema = z.object({
  slug: z.string(),
  name: z.string(),
  type: TestModeOrganizationTypeSchema,
  createdAt: z.string(),
})
export type TestModeOrganization = z.infer<typeof TestModeOrganizationSchema>

// A campaign org carries onboarding, pro, election and tenDlc; an elected
// office org carries onboarding and term. Absent families do not apply.
export const TestModeActiveOrganizationSchema = z.object({
  slug: z.string(),
  type: TestModeOrganizationTypeSchema,
  families: z.object({
    onboarding: TestModeFamilyStateSchema.optional(),
    pro: TestModeFamilyStateSchema.optional(),
    election: TestModeFamilyStateSchema.optional(),
    term: TestModeFamilyStateSchema.optional(),
    tenDlc: TestModeFamilyStateSchema.optional(),
  }),
})
export type TestModeActiveOrganization = z.infer<
  typeof TestModeActiveOrganizationSchema
>

export const TestModeStateSchema = z.object({
  organizations: z.array(TestModeOrganizationSchema),
  active: TestModeActiveOrganizationSchema.nullable(),
})
export type TestModeState = z.infer<typeof TestModeStateSchema>
