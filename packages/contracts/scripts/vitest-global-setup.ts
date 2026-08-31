import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ensureContractsBuilt } from './ensure-built'

// Shared by every workspace that imports contracts. It hangs off the vitest
// config rather than the `test` npm script because the invocation that
// actually strands people is `npx vitest run <path>`, which never goes
// through package.json at all.
//
// ESM entry: vitest loads global setup through vite-node, where __dirname
// does not exist. The CLI entry beside this one is the CJS counterpart.
export const setup = (): void => {
  ensureContractsBuilt(join(dirname(fileURLToPath(import.meta.url)), '..'))
}
