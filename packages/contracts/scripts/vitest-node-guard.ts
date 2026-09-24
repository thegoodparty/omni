import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { assertNodeVersion } from './assert-node-version'

// Contracts' own global setup, and deliberately NOT the shared
// `vitest-global-setup.ts` its consumers use.
//
// That one pairs the version guard with `ensureContractsBuilt`, which exists
// for packages that resolve contracts through `main`/`types` into dist/.
// Contracts' own tests import from src/, so dist is irrelevant to them — and
// its `generate-enums` step rewrites `src/generated/*` on every run, which
// restamps sources newer than dist and would make the staleness probe rebuild
// the package before every single contracts test run.
//
// So the owning package gets the guard without the build it does not need.
export const setup = (): void => {
  assertNodeVersion(join(dirname(fileURLToPath(import.meta.url)), '..'))
}
