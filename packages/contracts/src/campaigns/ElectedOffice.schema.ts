import { z } from "zod";

export const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
  swornInDate: z.coerce.date().nullish(),
  electedDate: z.coerce.date().nullish(),
  termStartDate: z.coerce.date().nullish(),
  termEndDate: z.coerce.date().nullish(),
  termLengthDays: z.number().nullish(),
  isActive: z.boolean(),
  party: z.string().nullish(),
  pledgedAt: z.coerce.date().nullish(),
  onboardingCompletedAt: z.coerce.date().nullish(),
  // True when the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill). Always present on the API
  // response; default keeps older/cached payloads parseable.
  selfReported: z.boolean().default(false),
  // Resume checkpoint: the furthest serve-onboarding step the holder reached,
  // written on every "Continue". Null when no checkpoint has been recorded.
  onboardingStep: z.string().nullish(),
  userId: z.number(),
  campaignId: z.number().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type ElectedOffice = z.infer<typeof ElectedOfficeSchema>;
