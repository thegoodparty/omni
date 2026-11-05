import { describe, expect, it } from 'vitest'
import {
  recordPickerFailure,
  shouldAlert,
  type FailureLogPort,
  type PickerFailure,
} from './pickerFailures'

const createFakeLog = (): FailureLogPort & { objects: Map<string, string> } => {
  const objects = new Map<string, string>()
  return {
    objects,
    putObject: async (key, body) => {
      objects.set(key, body)
    },
    listKeys: async (prefix) =>
      [...objects.keys()].filter((k) => k.startsWith(prefix)),
    getObject: async (key) => {
      const body = objects.get(key)
      if (body === undefined) throw new Error(`no object at ${key}`)
      return body
    },
  }
}

const failure = (overrides: Partial<PickerFailure> = {}): PickerFailure => ({
  pr: 1,
  runId: 'run-1',
  timestamp: '2026-11-01T00:00:00.000Z',
  reason: 'timeout_or_error',
  detail: 'boom',
  ...overrides,
})

describe('shouldAlert', () => {
  it('does not alert on a single failure', () => {
    expect(shouldAlert([failure()], new Date('2026-11-01T00:00:00.000Z'))).toBe(
      false,
    )
  })

  it('alerts when two failures fall within the trailing 7 days', () => {
    const failures = [
      failure({ runId: 'a', timestamp: '2026-11-01T00:00:00.000Z' }),
      failure({ runId: 'b', timestamp: '2026-11-03T00:00:00.000Z' }),
    ]
    expect(shouldAlert(failures, new Date('2026-11-03T00:00:00.000Z'))).toBe(
      true,
    )
  })

  it('does not alert when two failures are 8+ days apart', () => {
    const failures = [
      failure({ runId: 'a', timestamp: '2026-11-01T00:00:00.000Z' }),
      failure({ runId: 'b', timestamp: '2026-11-09T00:00:00.000Z' }),
    ]
    expect(shouldAlert(failures, new Date('2026-11-09T00:00:00.000Z'))).toBe(
      false,
    )
  })
})

describe('recordPickerFailure', () => {
  it('writes the failure and reports no alert on the first one', async () => {
    const log = createFakeLog()
    const result = await recordPickerFailure(log, failure())
    expect(result.shouldAlert).toBe(false)
    expect(result.windowCount).toBe(1)
    expect(log.objects.size).toBe(1)
  })

  it('reports an alert on the second failure within 7 days', async () => {
    const log = createFakeLog()
    await recordPickerFailure(log, failure({ runId: 'a' }))
    const result = await recordPickerFailure(
      log,
      failure({
        runId: 'b',
        pr: 2,
        timestamp: '2026-11-02T00:00:00.000Z',
      }),
    )
    expect(result.shouldAlert).toBe(true)
    expect(result.windowCount).toBe(2)
  })

  it('skips an unparsable object instead of failing the run', async () => {
    const log = createFakeLog()
    log.objects.set('guard/picker-failures/stray.json', 'not json at all')
    const result = await recordPickerFailure(log, failure())
    expect(result.windowCount).toBe(1)
  })
})
