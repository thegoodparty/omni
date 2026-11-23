import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Radix's Select and Checkbox measure themselves through a ResizeObserver,
// which jsdom does not implement. Nothing asserts on a measured size, so a
// no-op observer is enough to let them mount.
class ResizeObserverStub {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Radix's Select asks the element it opened from whether it still holds the
// pointer, and scrolls the highlighted item into view, neither of which jsdom
// implements.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => undefined
Element.prototype.releasePointerCapture ??= () => undefined
Element.prototype.scrollIntoView ??= () => undefined

// Automatic cleanup after each test
afterEach(() => {
  cleanup()
})
