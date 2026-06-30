import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { CampaignStory } from '@goodparty_org/contracts'
import { UpdateCampaignStoryInput } from '../schemas/updateCampaignStory.schema'

// Lifetime cap on AI "Help me rewrite" attempts per campaign, to bound Gemini
// cost/abuse beyond the per-user hourly burst limit.
export const REWRITE_LIFETIME_LIMIT = 200

@Injectable()
export class CampaignStoryService extends createPrismaBase(
  MODELS.CampaignStory,
) {
  async getForCampaign(campaignId: number): Promise<CampaignStory> {
    const story = await this.model.findUnique({ where: { campaignId } })
    return {
      why: story?.why ?? null,
      background: story?.background ?? null,
    }
  }

  async upsertForCampaign(
    campaignId: number,
    input: UpdateCampaignStoryInput,
  ): Promise<CampaignStory> {
    // Prisma's `upsert` is not transactional in Postgres (SELECT then
    // INSERT-or-UPDATE), so two autosave PUTs landing in the same window
    // before the row exists both attempt INSERT and the loser trips the
    // @@unique(campaign_id) constraint (P2002). The row exists by then, so
    // apply our fields as an UPDATE — re-fetching instead would drop them.
    try {
      const { why, background } = await this.model.upsert({
        where: { campaignId },
        create: { campaignId, ...input },
        update: input,
      })
      return { why, background }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const { why, background } = await this.model.update({
        where: { campaignId },
        data: input,
      })
      return { why, background }
    }
  }

  // Records one rewrite attempt against the campaign's lifetime budget and
  // returns whether it was admitted. The conditional increment is atomic, so
  // concurrent attempts can't push the count past the cap. The upsert ensures
  // a row exists first — the story row is created lazily on first save, which
  // may not have happened before the first rewrite.
  async admitRewriteAttempt(campaignId: number): Promise<boolean> {
    // Same non-transactional upsert race as upsertForCampaign: two first-ever
    // attempts landing before the row exists both INSERT and the loser trips
    // @@unique(campaign_id) (P2002). The row exists by then, which is all the
    // upsert needed, so swallow it and fall through to the increment.
    try {
      await this.model.upsert({
        where: { campaignId },
        create: { campaignId },
        update: {},
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
    const { count } = await this.model.updateMany({
      where: { campaignId, rewriteCount: { lt: REWRITE_LIFETIME_LIMIT } },
      data: { rewriteCount: { increment: 1 } },
    })
    return count > 0
  }

  // Refunds an attempt admitted by admitRewriteAttempt when the downstream
  // Gemini call fails, so an infra error (timeout, 502, bad output) doesn't
  // permanently burn one of the campaign's non-resetting lifetime slots. The
  // `gt: 0` guard keeps the counter from going negative.
  async rollbackRewriteAttempt(campaignId: number): Promise<void> {
    await this.model.updateMany({
      where: { campaignId, rewriteCount: { gt: 0 } },
      data: { rewriteCount: { decrement: 1 } },
    })
  }
}
