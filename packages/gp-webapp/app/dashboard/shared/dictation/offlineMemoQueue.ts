import type {
  ConstituentFeedbackCaptureMethod,
  RecordDoorKnockInteraction,
  RecordPhoneBankingCall,
} from '@goodparty_org/contracts'
import type { OutreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'

// What the phone holds while it has no signal: the knock or call a canvasser
// logged, and the memo they spoke about it, sent in that order once signal
// returns. Plain IndexedDB because a recording is a Blob, which neither
// localStorage nor a cookie can carry, and the queue has to outlive a reload.

const DB_NAME = 'issue-capture-queue'
const STORE = 'entries'
const DB_VERSION = 1

// Which memo, on which channel: the capture payload without its words.
export type QueuedMemoReference =
  | {
      channel: 'door_knock'
      knockClientKey: string
      stopTargetId: number
      clientKey: string
    }
  | {
      channel: 'phone_bank'
      entryId: number
      personId: string
      clientKey: string
    }

export type QueuedMemo = {
  reference: QueuedMemoReference
  // Typed or dictated words. Absent when the entry carries a recording.
  text?: {
    transcript: string
    captureMethod: Exclude<
      ConstituentFeedbackCaptureMethod,
      'dictation_offline'
    >
  }
  analytics: {
    channel: 'doorKnocking' | 'phoneBanking'
    product: OutreachProduct
  }
}

type EntryBase = {
  // `${kind}:${key}`, where the key names the door or the call: the stop
  // target for a knock, `entryId:personId` for a call. A memo shares its
  // knock's or call's key, so saving the same door again replaces both
  // entries instead of queueing a second pair, and a refused knock or call
  // can find the memo that depends on it.
  id: string
  // The org it was recorded in. Every request the drain makes goes out under
  // the active org, so an entry waits while another org is active.
  organizationSlug: string
  createdAt: number
}

export type QueueEntry =
  | (EntryBase & { kind: 'knock'; payload: RecordDoorKnockInteraction })
  | (EntryBase & {
      kind: 'call'
      payload: { listId: number; request: RecordPhoneBankingCall }
    })
  | (EntryBase & { kind: 'memo'; payload: QueuedMemo; blob?: Blob })

// `sent` and `rejected` leave the queue: a refused request will be refused
// again. `deferred` stays for a later drain. A send that throws stops the
// drain where it is.
export type SendOutcome = 'sent' | 'rejected' | 'deferred'

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, mode)
    const done = committed(tx)
    const result = await run(tx.objectStore(STORE))
    await done
    return result
  } finally {
    db.close()
  }
}

export const enqueue = (entries: QueueEntry[]): Promise<void> =>
  withStore('readwrite', async (store) => {
    await Promise.all(entries.map((entry) => promised(store.put(entry))))
  })

export const listQueue = (): Promise<QueueEntry[]> =>
  withStore('readonly', (store) => promised<QueueEntry[]>(store.getAll()))

export const removeFromQueue = (ids: string[]): Promise<void> =>
  withStore('readwrite', async (store) => {
    await Promise.all(ids.map((id) => promised(store.delete(id))))
  })

// The memo that rides on a knock or call: same key, `memo` kind.
const dependentMemoId = (entry: QueueEntry): string | null =>
  entry.kind === 'memo'
    ? null
    : `memo:${entry.id.slice(entry.id.indexOf(':') + 1)}`

// Knocks and calls before memos, oldest first within each. A memo resolves
// its knock or call on the server, so it can only go once that has landed.
const drainOrder = (entries: QueueEntry[]): QueueEntry[] =>
  [...entries].sort(
    (a, b) =>
      Number(a.kind === 'memo') - Number(b.kind === 'memo') ||
      a.createdAt - b.createdAt,
  )

let draining: Promise<number> | null = null

const drainOnce = async (
  send: (entry: QueueEntry) => Promise<SendOutcome>,
): Promise<number> => {
  let sent = 0
  const dropped = new Set<string>()
  for (const entry of drainOrder(await listQueue())) {
    if (dropped.has(entry.id)) continue
    let outcome: SendOutcome
    try {
      outcome = await send(entry)
    } catch {
      // No signal after all, a session not yet refreshed, or the server is
      // down. Whatever is left goes on the next drain, in the same order.
      return sent
    }
    if (outcome === 'deferred') continue
    // A refused knock or call takes its memo with it: the memo resolves it
    // on the server, so it would be refused too.
    const memoId = outcome === 'rejected' ? dependentMemoId(entry) : null
    if (memoId !== null) dropped.add(memoId)
    await removeFromQueue(memoId === null ? [entry.id] : [entry.id, memoId])
    if (outcome === 'sent') sent += 1
  }
  return sent
}

// Sends everything queued, in order, and resolves to how many entries went.
// One drain at a time: the `online` event and a return to the app often fire
// together, and the page and the form both listen, and two drains would send
// the same entry twice.
export const drainQueue = (
  send: (entry: QueueEntry) => Promise<SendOutcome>,
): Promise<number> => {
  if (draining === null) {
    draining = drainOnce(send).finally(() => {
      draining = null
    })
  }
  return draining
}
