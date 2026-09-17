import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class ContactInteractionPhoneBankingService extends createPrismaBase(
  MODELS.ContactInteractionPhoneBanking,
) {}
