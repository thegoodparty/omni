import { PerformanceObserver } from 'node:perf_hooks'
import * as webStreams from 'node:stream/web'

// The vm pool's global object is jsdom's window, which lacks the Node globals
// that the default pool inherits from Node's own global. msw needs the
// streams at import time, so this runs before every other setup file.
const nodeGlobals: Record<string, unknown> = {
  ReadableStream: webStreams.ReadableStream,
  WritableStream: webStreams.WritableStream,
  TransformStream: webStreams.TransformStream,
  TextEncoderStream: webStreams.TextEncoderStream,
  TextDecoderStream: webStreams.TextDecoderStream,
  CompressionStream: webStreams.CompressionStream,
  DecompressionStream: webStreams.DecompressionStream,
  ByteLengthQueuingStrategy: webStreams.ByteLengthQueuingStrategy,
  CountQueuingStrategy: webStreams.CountQueuingStrategy,
  PerformanceObserver,
}

for (const [name, value] of Object.entries(nodeGlobals)) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    })
  }
}
