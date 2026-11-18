import { useTestService } from '@/test-service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { AgentMessageRole, ChatMessageRole } from '../../generated/prisma'
import { randomUUID } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
import { ChatStoreService } from './chatStore.prisma'

const service = useTestService()

const createOtherUser = async () =>
  service.prisma.user.create({
    data: {
      id: 456,
      email: 'other@goodparty.org',
      firstName: 'Other',
      lastName: 'Person',
    },
  })

const createConversation = async (ownerUserId: number) =>
  service.prisma.chatConversation.create({
    data: { ownerUserId },
  })

describe('ChatStoreService', () => {
  let store: ChatStoreService

  beforeEach(() => {
    const prisma = service.app.get(PrismaService)
    store = new ChatStoreService()
    Object.defineProperty(store, '_prisma', {
      get: () => prisma,
      configurable: true,
    })
    Object.defineProperty(store, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
    store.onModuleInit()
  })

  describe('appendMessage with segments', () => {
    it('persists ordered segments and replays them in order', async () => {
      const convo = await createConversation(service.user.id)

      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.assistant,
        content: 'Looking... Found 3 supporters.',
        segments: [
          { kind: 'text', text: 'Looking...' },
          { kind: 'tool', toolName: 'web_search' },
          { kind: 'tool', toolName: 'crud_priorities' },
          { kind: 'text', text: 'Found 3 supporters.' },
        ],
      })

      const [msg] = await store.listMessagesByConversation(convo.id)
      expect(
        msg?.segments.map((s) => [s.ordinal, s.kind, s.text, s.toolName]),
      ).toEqual([
        [0, 'text', 'Looking...', null],
        [1, 'tool', null, 'web_search'],
        [2, 'tool', null, 'crud_priorities'],
        [3, 'text', 'Found 3 supporters.', null],
      ])
    })

    it('writes no segments for a plain message (backwards compatible)', async () => {
      const convo = await createConversation(service.user.id)
      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.assistant,
        content: 'No tools here.',
      })

      const [msg] = await store.listMessagesByConversation(convo.id)
      expect(msg?.segments).toHaveLength(0)
    })
  })

  describe('findConversationByIdAndOwner', () => {
    it('returns the row when id and ownerUserId match', async () => {
      const convo = await createConversation(service.user.id)

      const found = await store.findConversationByIdAndOwner(
        convo.id,
        service.user.id,
      )

      expect(found?.id).toBe(convo.id)
      expect(found?.ownerUserId).toBe(service.user.id)
      expect(found?.deletedAt).toBeNull()
    })

    it('returns null when id does not exist', async () => {
      const found = await store.findConversationByIdAndOwner(
        'nonexistent-id',
        service.user.id,
      )

      expect(found).toBeNull()
    })

    it('returns null when ownerUserId does not match', async () => {
      const other = await createOtherUser()
      const convo = await createConversation(other.id)

      const found = await store.findConversationByIdAndOwner(
        convo.id,
        service.user.id,
      )

      expect(found).toBeNull()
    })

    it('returns null when the conversation is soft-deleted', async () => {
      const convo = await createConversation(service.user.id)
      await service.prisma.chatConversation.update({
        where: { id: convo.id },
        data: { deletedAt: new Date() },
      })

      const found = await store.findConversationByIdAndOwner(
        convo.id,
        service.user.id,
      )

      expect(found).toBeNull()
    })
  })

  describe('listMessagesByConversation', () => {
    it('returns messages in index order', async () => {
      const convo = await createConversation(service.user.id)

      for (const [role, content] of [
        [ChatMessageRole.user, 'earliest'],
        [ChatMessageRole.assistant, 'middle'],
        [ChatMessageRole.user, 'latest'],
      ] as const) {
        await store.appendMessage({
          conversationId: convo.id,
          role,
          content,
        })
      }

      const messages = await store.listMessagesByConversation(convo.id)

      expect(messages.map((m) => m.content)).toEqual([
        'earliest',
        'middle',
        'latest',
      ])
    })

    it('returns an empty array when the conversation has no messages', async () => {
      const convo = await createConversation(service.user.id)

      const messages = await store.listMessagesByConversation(convo.id)

      expect(messages).toEqual([])
    })

    it('returns an empty array when the conversation does not exist', async () => {
      const messages = await store.listMessagesByConversation('nope')

      expect(messages).toEqual([])
    })

    it('returns an empty array when the conversation is soft-deleted', async () => {
      const convo = await createConversation(service.user.id)
      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'secret',
      })
      await service.prisma.chatConversation.update({
        where: { id: convo.id },
        data: { deletedAt: new Date() },
      })

      const messages = await store.listMessagesByConversation(convo.id)

      expect(messages).toEqual([])
    })
  })

  describe('listRecentMessagesByConversation', () => {
    it('returns at most limit messages ordered ASC (most recent slice)', async () => {
      const convo = await createConversation(service.user.id)
      for (let i = 0; i < 10; i++) {
        await store.appendMessage({
          conversationId: convo.id,
          role: ChatMessageRole.user,
          content: `msg-${i}`,
        })
      }

      const messages = await store.listRecentMessagesByConversation(convo.id, 3)

      expect(messages.map((m) => m.content)).toEqual([
        'msg-7',
        'msg-8',
        'msg-9',
      ])
    })

    it('returns all messages when count is less than limit', async () => {
      const convo = await createConversation(service.user.id)
      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'only',
      })

      const messages = await store.listRecentMessagesByConversation(
        convo.id,
        40,
      )

      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe('only')
    })

    it('returns empty when the conversation is soft-deleted', async () => {
      const convo = await createConversation(service.user.id)
      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'secret',
      })
      await service.prisma.chatConversation.update({
        where: { id: convo.id },
        data: { deletedAt: new Date() },
      })

      const messages = await store.listRecentMessagesByConversation(
        convo.id,
        40,
      )

      expect(messages).toEqual([])
    })
  })

  describe('appendMessage', () => {
    it('persists a message with the given role and content', async () => {
      const convo = await createConversation(service.user.id)
      const content = 'hello world'

      const created = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content,
      })

      expect(created.conversationId).toBe(convo.id)
      expect(created.role).toBe(ChatMessageRole.user)
      expect(created.content).toBe(content)
      expect(created.createdAt).toBeInstanceOf(Date)

      const persisted = await service.prisma.agentMessage.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(persisted.parts).toEqual([{ type: 'text', text: content }])
      expect(persisted.role).toBe(AgentMessageRole.user)
    })

    it('throws a Prisma error when conversationId does not exist', async () => {
      await expect(
        store.appendMessage({
          conversationId: 'does-not-exist',
          role: ChatMessageRole.assistant,
          content: 'orphan',
        }),
      ).rejects.toThrow()
    })

    it('lets the database assign an id when the caller has none', async () => {
      const convo = await createConversation(service.user.id)

      const created = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'hi',
      })

      expect(created.id).toMatch(UUID)
    })

    it('gives each row its own id', async () => {
      const convo = await createConversation(service.user.id)

      const first = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'a',
      })
      const second = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.user,
        content: 'b',
      })

      expect(first.id).not.toBe(second.id)
    })
  })

  describe('softDeleteConversation', () => {
    it('sets deletedAt when id and ownerUserId match', async () => {
      const convo = await createConversation(service.user.id)

      await store.softDeleteConversation(convo.id, service.user.id)

      const after = await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: convo.id },
      })
      expect(after.deletedAt).toBeInstanceOf(Date)
    })

    it('is a no-op when id does not match', async () => {
      const convo = await createConversation(service.user.id)

      await store.softDeleteConversation('wrong-id', service.user.id)

      const after = await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: convo.id },
      })
      expect(after.deletedAt).toBeNull()
    })

    it('is a no-op when ownerUserId does not match', async () => {
      const other = await createOtherUser()
      const convo = await createConversation(other.id)

      await store.softDeleteConversation(convo.id, service.user.id)

      const after = await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: convo.id },
      })
      expect(after.deletedAt).toBeNull()
    })

    it('does not overwrite deletedAt when row is already soft-deleted', async () => {
      const convo = await createConversation(service.user.id)
      const firstDeletedAt = new Date('2026-01-01T00:00:00Z')
      await service.prisma.chatConversation.update({
        where: { id: convo.id },
        data: { deletedAt: firstDeletedAt },
      })

      await store.softDeleteConversation(convo.id, service.user.id)

      const after = await service.prisma.chatConversation.findUniqueOrThrow({
        where: { id: convo.id },
      })
      expect(after.deletedAt?.toISOString()).toBe(firstDeletedAt.toISOString())
    })
  })

  describe('appendUserMessageIfAlive', () => {
    const countTurns = (conversationId: string) =>
      service.prisma.agentMessage.count({ where: { conversationId } })

    it('writes the user turn under the id the client sent', async () => {
      const convo = await createConversation(service.user.id)
      const id = randomUUID()

      const result = await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'hello',
        id,
      })

      expect(result?.replayed).toBe(false)
      expect(result?.message.id).toBe(id)
      expect(result?.message.role).toBe(ChatMessageRole.user)
      expect(result?.message.content).toBe('hello')
      expect(await countTurns(convo.id)).toBe(1)
    })

    it('reports a retry of the same send instead of writing a second turn', async () => {
      const convo = await createConversation(service.user.id)
      const id = randomUUID()
      const send = () =>
        store.appendUserMessageIfAlive({
          conversationId: convo.id,
          ownerUserId: service.user.id,
          content: 'hello',
          id,
        })

      const first = await send()
      const second = await send()

      expect(first?.replayed).toBe(false)
      expect(second?.replayed).toBe(true)
      expect(second?.message.id).toBe(id)
      expect(await countTurns(convo.id)).toBe(1)
    })

    it('refuses an id already used by another conversation', async () => {
      const mine = await createConversation(service.user.id)
      const theirs = await createConversation(service.user.id)
      const id = randomUUID()
      await store.appendUserMessageIfAlive({
        conversationId: theirs.id,
        ownerUserId: service.user.id,
        content: 'theirs',
        id,
      })

      await expect(
        store.appendUserMessageIfAlive({
          conversationId: mine.id,
          ownerUserId: service.user.id,
          content: 'mine',
          id,
        }),
      ).rejects.toBeInstanceOf(ConflictException)
      expect(await countTurns(mine.id)).toBe(0)
    })

    it('refuses an id already used by another owner', async () => {
      const other = await createOtherUser()
      const theirs = await createConversation(other.id)
      const mine = await createConversation(service.user.id)
      const id = randomUUID()
      await store.appendUserMessageIfAlive({
        conversationId: theirs.id,
        ownerUserId: other.id,
        content: 'theirs',
        id,
      })

      await expect(
        store.appendUserMessageIfAlive({
          conversationId: mine.id,
          ownerUserId: service.user.id,
          content: 'mine',
          id,
        }),
      ).rejects.toBeInstanceOf(ConflictException)
      expect(await countTurns(mine.id)).toBe(0)
    })

    it('refuses an id already used by an assistant row', async () => {
      const convo = await createConversation(service.user.id)
      const assistant = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.assistant,
        content: 'a reply',
      })

      await expect(
        store.appendUserMessageIfAlive({
          conversationId: convo.id,
          ownerUserId: service.user.id,
          content: 'hi',
          id: assistant.id,
        }),
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('returns null and does not persist when conversation is soft-deleted', async () => {
      const convo = await createConversation(service.user.id)
      await service.prisma.chatConversation.update({
        where: { id: convo.id },
        data: { deletedAt: new Date() },
      })

      const result = await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'hello',
      })

      expect(result).toBeNull()
      expect(await countTurns(convo.id)).toBe(0)
    })

    it('returns null when ownerUserId does not match', async () => {
      const other = await createOtherUser()
      const convo = await createConversation(other.id)

      const result = await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'hello',
      })

      expect(result).toBeNull()
      expect(await countTurns(convo.id)).toBe(0)
    })

    it('returns null when conversation does not exist', async () => {
      const result = await store.appendUserMessageIfAlive({
        conversationId: 'nope',
        ownerUserId: service.user.id,
        content: 'hello',
      })

      expect(result).toBeNull()
    })
  })

  describe('replayedReplyTo', () => {
    it('returns the reply stored after the user turn', async () => {
      const convo = await createConversation(service.user.id)
      const id = randomUUID()
      await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'question',
        id,
      })
      const reply = await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.assistant,
        content: 'answer',
      })

      const replayed = await store.replayedReplyTo(id)

      expect(replayed?.id).toBe(reply.id)
      expect(replayed?.content).toBe('answer')
    })

    it('returns null when the turn has no reply yet', async () => {
      const convo = await createConversation(service.user.id)
      const id = randomUUID()
      await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'question',
        id,
      })

      expect(await store.replayedReplyTo(id)).toBeNull()
    })

    it('does not reach into the next turn', async () => {
      const convo = await createConversation(service.user.id)
      const first = randomUUID()
      await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'first',
        id: first,
      })
      await store.appendUserMessageIfAlive({
        conversationId: convo.id,
        ownerUserId: service.user.id,
        content: 'second',
      })
      await store.appendMessage({
        conversationId: convo.id,
        role: ChatMessageRole.assistant,
        content: 'answer',
      })

      expect(await store.replayedReplyTo(first)).toBeNull()
    })
  })

  describe('softDeleteConversation cascading to annotation', () => {
    it('hard-deletes the owning chat-kind Annotation row', async () => {
      const convo = await createConversation(service.user.id)
      const annotation = await service.prisma.annotation.create({
        data: {
          authorUserId: service.user.id,
          kind: 'chat',
          resourceId: 'briefing-x',
          resourceType: 'briefing',
          chatConversationId: convo.id,
        },
      })

      await store.softDeleteConversation(convo.id, service.user.id)

      const stillThere = await service.prisma.annotation.findUnique({
        where: { id: annotation.id },
      })
      expect(stillThere).toBeNull()

      const convoAfter =
        await service.prisma.chatConversation.findUniqueOrThrow({
          where: { id: convo.id },
        })
      expect(convoAfter.deletedAt).toBeInstanceOf(Date)
    })

    it('does not delete unrelated annotations on a different conversation', async () => {
      const convoA = await createConversation(service.user.id)
      const convoB = await createConversation(service.user.id)
      const keep = await service.prisma.annotation.create({
        data: {
          authorUserId: service.user.id,
          kind: 'chat',
          resourceId: 'briefing-y',
          resourceType: 'briefing',
          chatConversationId: convoB.id,
        },
      })

      await store.softDeleteConversation(convoA.id, service.user.id)

      const survivor = await service.prisma.annotation.findUnique({
        where: { id: keep.id },
      })
      expect(survivor).not.toBeNull()
    })

    it('is a no-op on annotation when ownerUserId does not match', async () => {
      const other = await createOtherUser()
      const convo = await createConversation(other.id)
      const annotation = await service.prisma.annotation.create({
        data: {
          authorUserId: other.id,
          kind: 'chat',
          resourceId: 'briefing-z',
          resourceType: 'briefing',
          chatConversationId: convo.id,
        },
      })

      await store.softDeleteConversation(convo.id, service.user.id)

      const stillThere = await service.prisma.annotation.findUnique({
        where: { id: annotation.id },
      })
      expect(stillThere).not.toBeNull()
    })
  })
})
