import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ensureContractsBuilt } from './ensure-built'
import { assertNodeVersion } from './assert-node-version'

// Shared by every workspace that imports contracts. It hangs off the vitest
// config rather than the `test` npm script because the invocation that
// actually strands people is `npx vitest run <path>`, which never goes
// through package.json at all.
//
// ESM entry: vitest loads global setup through vite-node, where __dirname
// does not exist. The CLI entry beside this one is the CJS counterpart.
export const setup = (): void => {
  const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  // Before anything else: a suite run on the wrong Node major produces
  // failures that belong to the runtime and get mistaken for real ones.
  assertNodeVersion(contractsRoot)
  ensureContractsBuilt(contractsRoot)
}
