import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

// Anchor .env to the e2e-tests root, not process.cwd(): cohort scripts are run
// via an absolute tsx path and from varying directories, where a cwd-relative
// `dotenv/config` would silently find nothing and the env-guard in
// headless-user.ts would then throw a misleading "CLERK_SECRET_KEY is not set".
// Imported for its side effect BEFORE headless-user, so env is populated before
// that module's import-time guards run.
const e2eRoot = resolve(__dirname, '../..')

for (const file of ['.env', '.env.local']) {
  const path = resolve(e2eRoot, file)
  if (existsSync(path)) {
    loadEnv({ path, override: file === '.env.local' })
  }
}
