import { describe, expect, it } from 'vitest'
import { formatRunView } from './runViewFormat'

describe('formatRunView', () => {
  it('shows status, shape hash, steps and cost', () => {
    const text = formatRunView({
      runId: 'run-1',
      agent: 'meetingBriefing',
      status: 'running',
      shapeHash: 'abc123',
      steps: 9,
      costUsd: 0.4321,
    })
    expect(text).toContain('status   running')
    expect(text).toContain('shape    abc123')
    expect(text).toContain('steps    9')
    expect(text).toContain('cost     $0.4321')
    expect(text).toContain('artifact none yet')
  })

  it('says when cost was not recorded and shows the error and the replacement run', () => {
    const text = formatRunView({
      runId: 'run-1',
      agent: 'meetingBriefing',
      status: 'superseded',
      shapeHash: 'abc123',
      steps: 3,
      supersededBy: 'run-2',
      error: 'model refused',
    })
    expect(text).toContain('cost     not recorded')
    expect(text).toContain('superseded by run-2')
    expect(text).toContain('error    model refused')
  })
})
