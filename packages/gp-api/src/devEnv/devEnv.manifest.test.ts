import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { DECLARED_ENV_VARS } from './devEnv.manifest'
import { ENV_VAR_CONTRACT } from '@/shared/env/env.schema'

const WEBAPP_ENV_SCHEMA_PATH = join(
  __dirname,
  '../../../gp-webapp/env.schema.ts',
)

// ENV_VAR_CONTRACT entries are the only two-space-indented SCREAMING_CASE
// keys in that file; the type declarations above them are camelCase.
const declaredNames = (source: string) =>
  [...source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1])

describe('DECLARED_ENV_VARS', () => {
  it("tracks gp-api's own env contract without a copy", () => {
    expect([...DECLARED_ENV_VARS['gp-api']]).toEqual(
      Object.keys(ENV_VAR_CONTRACT),
    )
  })

  // The mirror in devEnv.manifest.ts exists because gp-api's runtime image
  // cannot import a sibling package's source. Drift in either direction
  // would silently change what the endpoint is willing to vend, so it fails
  // here instead.
  it("mirrors gp-webapp's env contract exactly", () => {
    const fromSource = declaredNames(
      readFileSync(WEBAPP_ENV_SCHEMA_PATH, 'utf8'),
    )

    expect(fromSource.length).toBeGreaterThan(0)
    expect([...DECLARED_ENV_VARS['gp-webapp']].sort()).toEqual(
      fromSource.sort(),
    )
  })
})
