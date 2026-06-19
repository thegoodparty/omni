import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

@Injectable()
export class ElectedOfficeSupportService extends createPrismaBase(
  MODELS.ElectedOfficeSupport,
) {
  constructor() {
    super()
  }

  async getByElectedOfficeId(electedOfficeId: string) {
    return this.model.findUnique({ where: { electedOfficeId } })
  }
}
