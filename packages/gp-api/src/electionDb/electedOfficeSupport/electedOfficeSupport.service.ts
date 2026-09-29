import { Injectable } from '@nestjs/common'
import {
  createElectionDbBase,
  ELECTION_MODELS,
} from '@/electionDb/electionDbBase.util'

@Injectable()
export class ElectedOfficeSupportService extends createElectionDbBase(
  ELECTION_MODELS.ElectedOfficeSupport,
) {
  async getByElectedOfficeId(electedOfficeId: string) {
    return this.model.findUnique({ where: { electedOfficeId } })
  }
}
