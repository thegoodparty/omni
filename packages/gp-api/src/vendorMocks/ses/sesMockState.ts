export const SES_MOCK_ACCOUNT_ID = '000000000000'

type MockMetrics = {
  send: number
  bounce: number
  complaint: number
  renderingFailure: number
}

// In-memory state for the SES and CloudWatch mocks. The send count per
// outreachEmailId tag defaults the Send metric, so a mocked send reports what
// it sent unless a test scripts other numbers.
class SesMockState {
  readonly tenants = new Map<
    string,
    { sendingStatus: 'ENABLED' | 'DISABLED' }
  >()
  readonly templates = new Set<string>()
  readonly scriptedMetrics = new Map<string, Partial<MockMetrics>>()
  private readonly sent = new Map<string, number>()

  recordSent(tag: string | undefined, count: number) {
    if (!tag) return
    this.sent.set(tag, (this.sent.get(tag) ?? 0) + count)
  }

  metricsFor(tag: string): MockMetrics {
    const scripted = this.scriptedMetrics.get(tag) ?? {}
    return {
      send: scripted.send ?? this.sent.get(tag) ?? 0,
      bounce: scripted.bounce ?? 0,
      complaint: scripted.complaint ?? 0,
      renderingFailure: scripted.renderingFailure ?? 0,
    }
  }
}

export const sesMockState = new SesMockState()
