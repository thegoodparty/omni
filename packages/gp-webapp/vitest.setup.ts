import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { testQueryClient } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { beforeEach, vi } from 'vitest'

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

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => router),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))
