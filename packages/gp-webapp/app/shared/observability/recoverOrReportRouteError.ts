import { isChunkLoadError } from './isChunkLoadError'
import {
  reportClientError,
  reportClientInterruption,
} from './reportClientError'

const RETRY_WINDOW_MS = 60_000

export const recoverOrReportRouteError = (error: Error) => {
  if (!isChunkLoadError(error)) {
    reportClientError(error)
    return undefined
  }

  const key = `chunk-reload:${window.location.pathname}`
  try {
    const lastReload = window.sessionStorage.getItem(key)
    if (
      lastReload !== null &&
      Date.now() - Number(lastReload) < RETRY_WINDOW_MS
    ) {
      reportClientError(error)
      return undefined
    }
  } catch {
    reportClientError(error)
    return undefined
  }

  reportClientInterruption('Retrying after a chunk failed to load')
  // Faro sends what it has batched every 250ms. Reloading on the spot could
  // tear the page down before the batch holding this log goes out.
  const reload = setTimeout(() => {
    try {
      window.sessionStorage.setItem(key, String(Date.now()))
    } catch {
      reportClientError(error)
      return
    }
    window.location.reload()
  }, 500)
  return () => clearTimeout(reload)
}
