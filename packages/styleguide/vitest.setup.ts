import '@testing-library/jest-dom/vitest'

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

// jsdom does not lay out, so it leaves Range measurement unimplemented, and
// ProseMirror measures a Range whenever a transaction scrolls the selection
// into view (TokenField's insertText does). An empty rect is the honest
// answer for an unlaid-out page.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  const emptyRects = (): DOMRectList =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getClientRects = emptyRects
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
