import { afterAll, vi } from 'vitest'

// The shared-modules project runs many files in one worker, and between files
// vitest restores mocks but nothing else. A file that leaves fake timers on
// hangs the next file's app.close() on a timer that never fires, until its
// hook times out; a leftover env or global stub silently changes what the
// next file runs against.
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
