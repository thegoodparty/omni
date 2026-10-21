import { vi } from 'vitest'

// jsdom has no IndexedDB and the repo carries no fake, so this is the
// smallest stand-in for the four calls the offline memo queue makes: open
// (with its upgrade), put, getAll and delete. Requests and transactions
// settle on a later microtask, as the real ones do. Each install is a fresh,
// empty database.
export const installIndexedDbShim = (): void => {
  const stores = new Map<string, Map<string, unknown>>()
  const settle = <T>(result: () => T) => {
    const request: {
      result?: T
      onsuccess?: () => void
      onerror?: () => void
    } = {}
    queueMicrotask(() => {
      request.result = result()
      request.onsuccess?.()
    })
    return request
  }
  const db = {
    createObjectStore: (name: string) => {
      stores.set(name, new Map())
    },
    transaction: (name: string) => {
      const records = stores.get(name)!
      let pending = 0
      const tx: {
        oncomplete?: () => void
        onerror?: () => void
        onabort?: () => void
        objectStore: () => unknown
      } = {
        objectStore: () => ({
          put: (value: { id: string }) =>
            track(() => records.set(value.id, value)),
          getAll: () => track(() => [...records.values()]),
          delete: (id: string) => track(() => records.delete(id)),
        }),
      }
      const track = <T>(run: () => T) => {
        pending += 1
        return settle(() => {
          const result = run()
          pending -= 1
          if (pending === 0) queueMicrotask(() => tx.oncomplete?.())
          return result
        })
      }
      return tx
    },
    close: () => undefined,
  }
  let opened = false
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: {
        result?: typeof db
        onupgradeneeded?: () => void
        onsuccess?: () => void
        onerror?: () => void
      } = {}
      queueMicrotask(() => {
        request.result = db
        if (!opened) {
          opened = true
          request.onupgradeneeded?.()
        }
        request.onsuccess?.()
      })
      return request
    },
  })
}
