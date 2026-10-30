import {
  CreatePriorityInputSchema,
  SetOnboardingPrioritiesInputSchema,
  UpdatePriorityInputSchema,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class CreatePriorityDto extends createZodDto(
  CreatePriorityInputSchema,
) {}

export class UpdatePriorityDto extends createZodDto(
  UpdatePriorityInputSchema,
) {}

export class PriorityIdParamDto extends createZodDto(
  z.object({ id: z.string() }),
) {}

export class PriorityThemeParamDto extends createZodDto(
  z.object({ id: z.string(), themeId: z.string() }),
) {}

export class PriorityThemeCommentsExportQueryDto extends createZodDto(
  z.object({ themeId: z.string().optional() }),
) {}

export class SetOnboardingPrioritiesDto extends createZodDto(
  SetOnboardingPrioritiesInputSchema,
) {}
