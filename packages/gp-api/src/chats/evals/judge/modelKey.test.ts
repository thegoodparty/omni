import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPEND_ENV, SPEND_VALUE } from './config'
import { ARM_KEY_ENV, KEY_ENV, restoreRealModelKey } from './modelKey'

// The stub `.env.test` hands every arm, written out so a reader can see what
// the fix is for rather than taking the word of a comment.
const STUB = 'test-anthropic-key'
const REAL = 'sk-ant-not-a-real-key'

describe('restoreRealModelKey', () => {
  it('moves the arm key into place for a spending arm', () => {
    const env = {
      [SPEND_ENV]: SPEND_VALUE,
      [ARM_KEY_ENV]: REAL,
      [KEY_ENV]: STUB,
    }
    expect(restoreRealModelKey(env)).toBe(true)
    expect(env[KEY_ENV]).toBe(REAL)
  })

  // THE SAFETY PROPERTY, and the reason the spend switch is read here at all:
  // a dry run keeps the stub, so the canned path cannot reach the real API
  // even with the key sitting in its environment.
  it('leaves the stub alone when the arm is not spending', () => {
    const env = { [ARM_KEY_ENV]: REAL, [KEY_ENV]: STUB }
    expect(restoreRealModelKey(env)).toBe(false)
    expect(env[KEY_ENV]).toBe(STUB)
  })

  it.each(['TRUE', 'yes', '1', ''])(
    'reads %s as not spending, like every other spend gate',
    (value) => {
      const env = {
        [SPEND_ENV]: value,
        [ARM_KEY_ENV]: REAL,
        [KEY_ENV]: STUB,
      }
      expect(restoreRealModelKey(env)).toBe(false)
      expect(env[KEY_ENV]).toBe(STUB)
    },
  )

  // WHAT THE FIRST LIVE SWEEP DID: the real key was exported under
  // ANTHROPIC_API_KEY, `.env.test` replaced it with the stub, and the arm
  // spent its way through every case collecting `invalid x-api-key`. A
  // spending arm with nothing under the arm name must not get that far.
  it.each([undefined, ''])(
    'refuses to start a spending arm when the arm key is %p',
    (passed) => {
      const env = {
        [SPEND_ENV]: SPEND_VALUE,
        [KEY_ENV]: STUB,
        ...(passed !== undefined && { [ARM_KEY_ENV]: passed }),
      }
      expect(() => restoreRealModelKey(env)).toThrow(
        new RegExp(`${ARM_KEY_ENV} is not set`),
      )
      // Not partially applied: the message is the whole contract, and a key
      // half-moved would be a second failure mode to diagnose.
      expect(env[KEY_ENV]).toBe(STUB)
    },
  )

  // The two names must differ, which is the entire mechanism. If a rename
  // ever collapsed them, `.env.test` would win again and every assertion
  // above would still pass.
  it('travels under a name .env.test does not define', () => {
    expect(ARM_KEY_ENV).not.toBe(KEY_ENV)
    const envTest = readFileSync(
      path.resolve(__dirname, '../../../..', '.env.test'),
      'utf8',
    )
    expect(envTest).toMatch(new RegExp(`^${KEY_ENV}=`, 'm'))
    expect(envTest).not.toMatch(new RegExp(`^${ARM_KEY_ENV}=`, 'm'))
  })
})

// THE ONE HOP NOTHING ELSE COVERS. Every assertion above is about the
// function; none of them notices if the arm suite stops calling it, and the
// suite that would notice is skipped unless JUDGE_ARM is set — so deleting
// the call leaves the whole judge suite green and every live sweep dead. It
// also has to run at MODULE scope, ahead of `useTestService()`: LlmService
// reads the key when the app boots in a beforeAll hook, so a call from a test
// body is too late to matter.
describe('the arm suite applies it before the app boots', () => {
  const source = readFileSync(
    path.resolve(__dirname, 'sweep.eval.test.ts'),
    'utf8',
  )

  it('calls it', () => {
    expect(source).toContain('restoreRealModelKey()')
  })

  it('calls it at module scope, above useTestService', () => {
    // Anchored on the declaration, not on the bare call: this file's own
    // header comment names `useTestService()` eight hundred characters
    // earlier, and matching that put the boot before the import.
    const call = source.indexOf('restoreRealModelKey()')
    const boot = source.indexOf('const service = useTestService()')
    expect(call).toBeGreaterThan(-1)
    expect(boot).toBeGreaterThan(-1)
    expect(call).toBeLessThan(boot)
    // Not nested inside anything: a module-scope statement starts at column
    // zero, and a call indented under a describe or an it would satisfy the
    // ordering check above while running after the hooks.
    expect(source).toMatch(/^if \(process\.env\.JUDGE_ARM !== undefined\)/m)
  })
})
