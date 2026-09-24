import { readFileSync } from 'fs'
import { dirname, join } from 'path'

// The repo pins Node in `.nvmrc`, and `engines` in package.json says the same
// thing — but nothing enforced either where it mattered. `engine-strict` gates
// `npm install`; it does not gate `npx vitest run <path>` against a
// node_modules that is already there. So a session can run every suite on the
// wrong major and never be told.
//
// What that costs is not a clean failure. It is a set of tests that fail for
// reasons belonging to the runtime, which read exactly like pre-existing
// breakage: jsdom losing `window.localStorage`, and a fake-timer test
// delivering one heartbeat instead of three. Both were reported as
// "pre-existing" across a long session, with a clean-tree re-run offered as
// proof — a control that shared the same wrong Node and therefore confirmed
// nothing. Under the pinned major both pass.
//
// Hence a hard failure rather than a warning. `engines` is already a warning
// and it is routinely scrolled past; the whole point is to stop before
// producing results nobody should trust.
//
// MAJOR only, deliberately. `engines` says `22`, and 22.23.2 against a pinned
// 22.23.0 is not the problem this guards — refusing it would train people to
// bypass the check, which is worse than not having one.
const majorOf = (version: string): string | null => {
  const match = /(\d+)/.exec(version.trim())
  return match?.[1] ?? null
}

export const assertNodeVersion = (contractsRoot: string): void => {
  const repoRoot = dirname(dirname(contractsRoot))
  let pinned: string
  try {
    pinned = readFileSync(join(repoRoot, '.nvmrc'), 'utf8')
  } catch {
    // No pin to check against. A missing `.nvmrc` is a repo-layout question,
    // not a reason to refuse to run tests.
    return
  }

  const want = majorOf(pinned)
  const have = majorOf(process.version.replace(/^v/, ''))
  if (!want || !have || want === have) return

  throw new Error(
    [
      `Node ${process.version} is running, but this repo pins Node ${pinned.trim()} (.nvmrc).`,
      '',
      'Test results on a different major are not evidence — failures appear',
      'that belong to the runtime and look exactly like pre-existing breakage.',
      '',
      'Fix it with `nvm use` (or your version manager) and run again.',
    ].join('\n'),
  )
}
