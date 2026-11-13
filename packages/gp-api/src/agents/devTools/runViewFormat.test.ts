import { describe, expect, it } from 'vitest'
import { formatRunView } from './runViewFormat'

describe('formatRunView', () => {
  it('shows status, shape hash, cost and every stage', () => {
    const text = formatRunView({
      runId: 'run-1',
      agent: 'meetingBriefing',
      status: 'running',
      shapeHash: 'abc123',
      costUsd: 0.4321,
      stages: [
        { name: 'findAgenda', status: 'completed', steps: 9, output: {} },
        { name: 'readPacket', status: 'running', steps: 3 },
      ],
    })
    expect(text).toContain('status   running')
    expect(text).toContain('shape    abc123')
    expect(text).toContain('cost     $0.4321')
    expect(text).toMatch(/findAgenda\s+completed\s+9\s+saved/)
    expect(text).toMatch(/readPacket\s+running\s+3\s+-/)
    expect(text).toContain('artifact none yet')
  })

  it('says when cost was not recorded and shows the error', () => {
    const text = formatRunView({
      runId: 'run-1',
      agent: 'meetingBriefing',
      status: 'failed',
      shapeHash: 'abc123',
      stages: [],
      error: 'model refused',
    })
    expect(text).toContain('cost     not recorded')
    expect(text).toContain('error    model refused')
  })
})
