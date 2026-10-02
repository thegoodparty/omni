import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installIndexedDbShim } from 'helpers/test-utils/indexedDbShim'
import {
  drainQueue,
  enqueue,
  listQueue,
  type QueueEntry,
} from './offlineMemoQueue'

const knockEntry = (key: string, createdAt: number): QueueEntry => ({
  id: `knock:${key}`,
  kind: 'knock',
  organizationSlug: 'campaign-1',
  payload: { stopTargetId: 21, clientKey: key, outcome: 'answered' },
  createdAt,
})

const memoEntry = (key: string, createdAt: number): QueueEntry => ({
  id: `memo:${key}`,
  kind: 'memo',
  organizationSlug: 'campaign-1',
  payload: {
    reference: {
      channel: 'door_knock',
      knockClientKey: key,
      stopTargetId: 21,
      clientKey: key,
    },
    analytics: { channel: 'doorKnocking', product: 'win' },
  },
  blob: new Blob(['audio'], { type: 'audio/webm' }),
  createdAt,
})

beforeEach(() => {
  installIndexedDbShim()
})

describe('offlineMemoQueue', () => {
  it('holds what it is given until it is sent', async () => {
    await enqueue([knockEntry('a', 1), memoEntry('a', 2)])

    expect((await listQueue()).map((entry) => entry.id).sort()).toEqual([
      'knock:a',
      'memo:a',
    ])
  })

  // The memo resolves its knock on the server, so a memo sent first would
  // 404 and be lost. Even one queued before its knock goes after it.
  it('sends a knock before the memo that belongs to it', async () => {
    await enqueue([memoEntry('a', 1), knockEntry('a', 2)])
    const sent: string[] = []

    await drainQueue(async (entry) => {
      sent.push(entry.id)
      return 'sent'
    })

    expect(sent).toEqual(['knock:a', 'memo:a'])
    expect(await listQueue()).toEqual([])
  })

  // A drain that loses signal partway keeps the failed entry and everything
  // after it, and the next drain picks up there: nothing is sent twice and
  // nothing jumps the queue.
  it('picks up where a failed drain stopped, sending nothing twice', async () => {
    await enqueue([
      knockEntry('a', 1),
      memoEntry('a', 2),
      knockEntry('b', 3),
      memoEntry('b', 4),
    ])
    const sent: string[] = []
    let failOnce = true

    await drainQueue(async (entry) => {
      if (entry.id === 'memo:a' && failOnce) {
        failOnce = false
        throw new Error('offline')
      }
      sent.push(entry.id)
      return 'sent'
    })
    expect(sent).toEqual(['knock:a', 'knock:b'])
    expect((await listQueue()).map((entry) => entry.id).sort()).toEqual([
      'memo:a',
      'memo:b',
    ])

    await drainQueue(async (entry) => {
      sent.push(entry.id)
      return 'sent'
    })
    expect(sent).toEqual(['knock:a', 'knock:b', 'memo:a', 'memo:b'])
    expect(await listQueue()).toEqual([])
  })

  // A request the server refused will be refused again, so it leaves the
  // queue rather than blocking every memo behind it.
  it('drops a refused entry and carries on', async () => {
    await enqueue([knockEntry('a', 1), memoEntry('a', 2)])
    const sent: string[] = []

    await drainQueue(async (entry) => {
      sent.push(entry.id)
      return entry.kind === 'knock' ? 'rejected' : 'sent'
    })

    expect(sent).toEqual(['knock:a', 'memo:a'])
    expect(await listQueue()).toEqual([])
  })

  // Another org's entries wait for that org, without holding up this one's.
  it('leaves a deferred entry queued and carries on', async () => {
    await enqueue([knockEntry('a', 1), memoEntry('a', 2)])

    await drainQueue(async (entry) =>
      entry.kind === 'knock' ? 'deferred' : 'sent',
    )

    expect((await listQueue()).map((entry) => entry.id)).toEqual(['knock:a'])
  })

  it('runs one drain at a time', async () => {
    await enqueue([knockEntry('a', 1)])
    const send = vi.fn(async () => 'sent' as const)

    await Promise.all([drainQueue(send), drainQueue(send)])

    expect(send).toHaveBeenCalledTimes(1)
  })
})
