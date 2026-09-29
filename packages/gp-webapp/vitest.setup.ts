import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { testQueryClient } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { afterEach, beforeEach, vi } from 'vitest'

// waitFor/findBy default to a 1s deadline, which is a bet on machine speed
// rather than anything the assertions mean. Suites that poll for a debounced
// count or a streamed response clear it on an idle CI runner and blow it on a
// developer machine running other work. A passing assertion still returns on
// its first successful poll; only genuine failures take longer to report.
configure({ asyncUtilTimeout: 5000 })

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  const noop = (): void => undefined
  window.ResizeObserver = class ResizeObserver {
    observe = noop
    unobserve = noop
    disconnect = noop
  }
}

if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  const noop = (): void => undefined
  Element.prototype.setPointerCapture = noop
  Element.prototype.releasePointerCapture = noop
  Element.prototype.hasPointerCapture = () => false
}

// jsdom doesn't implement scrollIntoView; Radix Select calls it when its
// listbox opens, otherwise throwing an async uncaught error in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (): void => undefined
}

// jsdom doesn't implement elementFromPoint; input-otp calls it from a timer to
// position its fake caret, which otherwise throws an async uncaught error.
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = (): null => null
}

// jsdom's CSSStyleDeclaration returns `""` for `transform` and
// `undefined` for the webkit/moz variants. vaul reads them via
// `(transform || webkitTransform || mozTransform).match(...)` in drag
// handlers, which short-circuits to `undefined` and throws. Coerce all
// three to a real "none" string so vaul's regex match returns null
// instead of crashing.
if (typeof CSSStyleDeclaration !== 'undefined') {
  for (const prop of ['transform', 'webkitTransform', 'mozTransform']) {
    Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
      configurable: true,
      get(): string {
        return 'none'
      },
    })
  }
}

beforeEach(() => {
  testQueryClient.clear()
})

// Radix defers its unmount autofocus to a setTimeout(…, 0) — a React 16 focus
// workaround it still carries. When a file's last test unmounts a dialog or
// drawer, that timer can outlive the jsdom environment, and it then builds a
// CustomEvent from the replacement global and dispatches it at an element from
// the old one: "Failed to execute 'dispatchEvent': parameter 1 is not of type
// 'Event'". Vitest reports that as an unhandled error, which fails the whole
// shard while every test passes — it is how AssistantDrawer.test.tsx took the
// release train down. Unmounting here and then yielding one macrotask drains
// the timer while its realm is still alive. cleanup() is idempotent and runs
// before the await, so this holds whatever order Testing Library's own
// auto-cleanup hook happens to run in.
// Skipped under a fake clock, where the yield would never resolve and would
// instead hang the hook until it times out. Nothing is lost: a deferred timer
// on a fake clock only runs if a test advances it, and the clock is thrown
// away with the file, so it can never reach a dead realm the way a real one
// can.
afterEach(async () => {
  cleanup()
  if (vi.isFakeTimers()) return
  await new Promise((resolve) => setTimeout(resolve, 0))
})

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => router),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))
