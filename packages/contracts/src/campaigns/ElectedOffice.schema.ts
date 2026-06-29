import { z } from "zod";
import { zCoerceDate } from "../shared/Date.schema";

export const ElectedOfficeSchema = z.object({
  id: z.string(),
  organizationSlug: z.string(),
  swornInDate: zCoerceDate().nullish(),
  electedDate: zCoerceDate().nullish(),
  termStartDate: zCoerceDate().nullish(),
  termEndDate: zCoerceDate().nullish(),
  termLengthDays: z.number().nullish(),
  isActive: z.boolean(),
  party: z.string().nullish(),
  pledgedAt: zCoerceDate().nullish(),
  onboardingCompletedAt: zCoerceDate().nullish(),
  // True when the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill). Always present on the API
  // response; default keeps older/cached payloads parseable.
  selfReported: z.boolean().default(false),
  // Resume checkpoint: the furthest serve-onboarding step the holder reached,
  // written on every "Continue". Null when no checkpoint has been recorded.
  onboardingStep: z.string().nullish(),
  userId: z.number(),
  campaignId: z.number().nullish(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
});

export type ElectedOffice = z.infer<typeof ElectedOfficeSchema>;
