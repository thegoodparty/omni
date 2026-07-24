import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { RecommendedListsRecomputeMessage } from '@/queue/queue.types'

@Injectable()
export class RecommendedListsComputeService extends createPrismaBase(
  MODELS.RecommendedListsSnapshot,
) {
  async handleRecompute(
    _message: RecommendedListsRecomputeMessage,
  ): Promise<boolean> {
    return true
  }
}
