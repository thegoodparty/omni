import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  CUSTOM_CHANNELS,
  CUSTOM_FILTERS,
  CUSTOM_PURPOSES,
  VoterFileType,
} from '../voterFile.types'
import { CampaignTaskType } from 'src/campaigns/tasks/campaignTasks.types'
import { parseJsonString } from 'src/shared/util/zod.util'
import { OutreachType } from '../../../generated/prisma'

const LOWER_CASE_TYPE_MAP = {
  doorknocking: VoterFileType.doorKnocking,
  directmail: VoterFileType.directMail,
  digitalads: VoterFileType.digitalAds,
  telemarketing: VoterFileType.telemarketing,
}

export class GetVoterFileSchema extends createZodDto(
  z.object({
    type: z.preprocess(
      (val): unknown => {
        // check if val is a lowercase version
        // Zod transform input is unknown — z.preprocess callback receives unknown
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const key = val as keyof typeof LOWER_CASE_TYPE_MAP
        return LOWER_CASE_TYPE_MAP[key] ?? val
      },
      z.union([
        z.nativeEnum(VoterFileType),
        z.nativeEnum(CampaignTaskType),
        z.nativeEnum(OutreachType),
      ]),
    ),
    customFilters: parseJsonString(
      z
        .object({
          channel: z.enum(CUSTOM_CHANNELS).optional(),
          purpose: z.enum(CUSTOM_PURPOSES).optional(),
          filters: z.array(z.enum(CUSTOM_FILTERS)),
        })
        .optional(),
    ),
    countOnly: z.coerce.boolean().optional(),
    slug: z.string().optional(),
  }),
) {}
