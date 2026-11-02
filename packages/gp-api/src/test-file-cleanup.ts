import { workerEnv } from './test-worker-env'
// configrc and the generated Prisma clients load packages/gp-api/.env on
// import. CI has no .env, so a local run would see keys CI never does, and a
// module that reads env at import (peerlyBaseConfig reads
// PEERLY_TEST_ENVIRONMENT) would keep the local value for the whole worker.
// Load them here, before the test file, so the reset below drops what they
// added.
import './configrc'
import './generated/prisma'
import './generated/election-prisma'
import { afterAll, vi } from 'vitest'

// Every file starts from the worker's starting env, so an env write an earlier
// file left behind cannot reach the next one. This runs at file start, not in
// afterAll, because vitest skips hooks for a file whose tests are all skipped,
// and such a file still runs its imports.
for (const key of Object.keys(process.env)) {
  if (!(key in workerEnv)) delete process.env[key]
}
Object.assign(process.env, workerEnv)

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
