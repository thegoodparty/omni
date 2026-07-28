import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UseDictationAppendResult } from 'app/dashboard/briefings/shared/useDictationAppend'
import type { DictationStatus } from 'app/dashboard/briefings/shared/useDictation'
import type { StoryRewrite } from 'app/dashboard/campaign-story/components/useStoryRewrite'
import StoryFieldBar from './StoryFieldBar'

const rewrite: StoryRewrite = {
  isRewriting: false,
  rewriteError: false,
  limitReached: false,
  canUndo: false,
  requestRewrite: vi.fn(),
  undo: vi.fn(),
}

// ACTIVE = requesting_mic | connecting | recording | stopping (matches the
// hook's ACTIVE_STATUSES); busy is a subset but StoryFieldBar keys off status.
const dictation = (status: DictationStatus): UseDictationAppendResult => ({
  status,
  error: null,
  partialTranscript: '',
  active: ['requesting_mic', 'connecting', 'recording', 'stopping'].includes(
    status,
  ),
  busy: ['requesting_mic', 'connecting', 'stopping'].includes(status),
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
})

const renderBar = (status: DictationStatus) =>
  render(
    <StoryFieldBar
      rewrite={rewrite}
      dictation={dictation(status)}
      improveDisabled={false}
    />,
  )

describe('StoryFieldBar recording states', () => {
  it('shows the mic button and no status text when idle', () => {
    renderBar('idle')
    expect(
      screen.getByRole('button', { name: /record voice/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/listening/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/transcribing/i)).not.toBeInTheDocument()
  })

  it('shows the stop button + "Listening…" the moment capture starts (no wait for the socket)', () => {
    // requesting_mic is the very first state after tapping the mic.
    renderBar('requesting_mic')
    expect(
      screen.getByRole('button', { name: /stop recording/i }),
    ).toBeEnabled()
    expect(screen.getByText(/listening…/i)).toBeInTheDocument()
  })

  it('keeps "Listening…" + an enabled stop while recording', () => {
    renderBar('recording')
    expect(
      screen.getByRole('button', { name: /stop recording/i }),
    ).toBeEnabled()
    expect(screen.getByText(/listening…/i)).toBeInTheDocument()
  })

  it('shows "Transcribing…" with a disabled stop while the flush drains', () => {
    renderBar('stopping')
    expect(screen.getByText(/transcribing…/i)).toBeInTheDocument()
    expect(screen.queryByText(/listening/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /stop recording/i }),
    ).toBeDisabled()
  })
})
