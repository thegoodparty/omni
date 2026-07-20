import { Injectable } from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { Organization, OutreachType } from '../../generated/prisma'
import { CampaignTaskType } from 'src/campaigns/tasks/campaignTasks.types'
import { ContactsService } from 'src/contacts/services/contacts.service'
import { GetVoterFileSchema } from './schemas/GetVoterFile.schema'
import { buildVoterFilePeopleFilter } from './util/voterFilePeopleFilter.util'
import {
  CHANNEL_TO_TYPE_MAP,
  TASK_TO_TYPE_MAP,
  VoterFileType,
} from './voterFile.types'

@Injectable()
export class VoterFileService {
  constructor(private readonly contacts: ContactsService) {}

  async getCount(
    organization: Organization,
    query: GetVoterFileSchema,
  ): Promise<number> {
    const { filterInput, groupByHousehold } = this.resolveFilter(query)
    return this.contacts.countVoterFilePeople(
      filterInput,
      groupByHousehold,
      organization,
    )
  }

  async streamCsv(
    organization: Organization,
    query: GetVoterFileSchema,
    res: FastifyReply,
  ): Promise<void> {
    const { filterInput, groupByHousehold } = this.resolveFilter(query)
    return this.contacts.downloadVoterFilePeople(
      filterInput,
      groupByHousehold,
      organization,
      res,
    )
  }

  private resolveFilter({ type, customFilters }: GetVoterFileSchema) {
    const resolvedType: VoterFileType =
      type === VoterFileType.custom && customFilters?.channel
        ? CHANNEL_TO_TYPE_MAP[customFilters.channel]
        : (Object.values(CampaignTaskType) as string[]).includes(type as string)
          ? // Union narrowing from dynamic input — runtime value comes from user request
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            TASK_TO_TYPE_MAP[type as CampaignTaskType]
          : type === OutreachType.p2p
            ? VoterFileType.sms
            : // Union narrowing from dynamic input — runtime value comes from user request
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              (type as VoterFileType)

    return buildVoterFilePeopleFilter(resolvedType, customFilters)
  }
}
