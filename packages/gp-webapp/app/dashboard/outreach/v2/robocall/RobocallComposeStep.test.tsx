import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { RobocallComposeStep } from './RobocallComposeStep'
import type { RobocallRecorder } from './useRobocallRecorder'

// A saved recording is what surfaces the compliance-checking label in the
// record bar; everything else is a benign default.
const savedRecorder: RobocallRecorder = {
  status: 'saved',
  elapsedSec: 0,
  recording: { blob: new Blob(['x']), url: 'blob:mock', durationSec: 5 },
  error: null,
  start: vi.fn(),
  stop: vi.fn(),
  discard: vi.fn(),
  save: vi.fn(),
  uploadFile: vi.fn(),
  reset: vi.fn(),
}

const baseProps = {
  tone: 'warm' as const,
  onToneChange: vi.fn(),
  isCustomPurpose: false,
  draft: 'This is Alex, running for City Council.',
  onDraftChange: vi.fn(),
  onRegenerate: vi.fn(),
  isDrafting: false,
  isDraftError: false,
  audienceName: 'Renters in 98103',
  // Set so the compose body (and the record bar) renders.
  callbackNumber: '+15125550123',
  isRentingNumber: false,
  rentError: false,
  onRetryNumber: vi.fn(),
  recorder: savedRecorder,
  maxSeconds: 60,
  onSaveRecording: vi.fn(),
  isUploading: false,
  uploadError: null,
  complianceChecking: true,
  complianceVerdict: null,
  complianceError: false,
  onRetryCompliance: vi.fn(),
}

describe('RobocallComposeStep compliance-check label', () => {
  afterEach(() => vi.useRealTimers())

  it('shows "Transcribing…" first, then flips to compliance after 5s', () => {
    vi.useFakeTimers()
    render(<RobocallComposeStep {...baseProps} />)

    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(
      screen.queryByText('Checking for compliance…'),
    ).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByText('Checking for compliance…')).toBeInTheDocument()
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument()
  })
})
