import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

export type LocalNewsJurisdiction = {
  office: string
  city: string
  state: string
}

@Injectable()
export class LocalNewsCacheService extends createPrismaBase(
  MODELS.LocalNewsCache,
) {
  findByJurisdiction(jurisdiction: LocalNewsJurisdiction) {
    return this.findFirst({ where: jurisdiction })
  }
}
