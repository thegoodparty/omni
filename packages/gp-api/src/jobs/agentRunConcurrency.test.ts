import { describe, expect, it } from 'vitest'
import {
  AGENT_RUN_MAX_CONCURRENT,
  agentRunConcurrency,
} from './agentRunConcurrency.util'

describe('agentRunConcurrency', () => {
  it('runs the whole fleet cap on a preview, its only task', () => {
    expect(agentRunConcurrency('preview')).toBe(AGENT_RUN_MAX_CONCURRENT)
  })

  // Dev and prod reach the cap by autoscaling to 5 tasks, so more slots per
  // task would only race the cap and leave a run waiting for a slot the task
  // already holds.
  it.each(['dev', 'prod'])('keeps %s at two jobs a task', (environment) => {
    expect(agentRunConcurrency(environment)).toBe(2)
  })

  // An absent or unexpected value is local or vitest, and fails to the
  // smaller number rather than to the preview's one.
  it.each([undefined, 'local', 'test', 'staging'])(
    'treats %s as no deploy',
    (environment) => {
      expect(agentRunConcurrency(environment)).toBe(2)
    },
  )
})
