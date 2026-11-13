import { describe, expect, it } from 'vitest'
import { workerQueueFilter } from './jobs.service'

describe('workerQueueFilter', () => {
  it('works every queue when unset', () => {
    expect(workerQueueFilter(undefined)).toBeUndefined()
    expect(workerQueueFilter('')).toBeUndefined()
  })

  it('works none when off, and only the named queues otherwise', () => {
    expect(workerQueueFilter('off')).toEqual(new Set())
    expect(workerQueueFilter('agentRun,myJob')).toEqual(
      new Set(['agentRun', 'myJob']),
    )
  })
})
