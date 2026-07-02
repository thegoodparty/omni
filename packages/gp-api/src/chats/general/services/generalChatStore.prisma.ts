import { Injectable } from '@nestjs/common'
import { ChatConversation, ChatScope, Prisma } from '../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type { ChatAnchor } from '@goodparty_org/contracts'

// Scope-aware conversation queries for the general (non-annotation) chat. The
// shared ChatStoreService owns messages + soft delete; this owns conversation
// create and history-by-scope so the briefing-chat store stays untouched.
@Injectable()
export class GeneralChatStoreService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  createScopedConversation(args: {
    ownerUserId: number
    organizationSlug: string | null
    scope: ChatScope
    anchor?: ChatAnchor
    title?: string
  }): Promise<ChatConversation> {
    return this.model.create({ data: args })
  }

  listByScope(args: {
    ownerUserId: number
    organizationSlug: string | null
    scope: ChatScope
  }): Promise<ChatConversation[]> {
    const { ownerUserId, organizationSlug, scope } = args
    return this.findMany({
      where: { ownerUserId, organizationSlug, scope, deletedAt: null },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
    })
  }

  findOwnedConversation(
    id: string,
    ownerUserId: number,
    scope: ChatScope,
    organizationSlug: string | null,
  ): Promise<ChatConversation | null> {
    return this.findFirst({
      where: { id, ownerUserId, scope, organizationSlug, deletedAt: null },
    })
  }

  // The candidate's most recent conversation in a scope, for scopes that run as
  // a single ongoing thread (the campaign manager) rather than one per open.
  findLatestByScope(args: {
    ownerUserId: number
    organizationSlug: string | null
    scope: ChatScope
  }): Promise<ChatConversation | null> {
    const { ownerUserId, organizationSlug, scope } = args
    return this.findFirst({
      where: { ownerUserId, organizationSlug, scope, deletedAt: null },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
    })
  }

  // Sets the title once, only if it is still null, so a concurrent/repeat send
  // can't clobber the first user message's truncation.
  async setTitleIfUnset(id: string, title: string): Promise<void> {
    await this.model.updateMany({
      where: { id, title: null },
      data: { title },
    })
  }
}
