import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import {
  NO_SPEECH_ISSUE,
  RobocallComplianceService,
} from './robocallCompliance.service'
import { RobocallTranscriptionService } from './robocallTranscription.service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

// VENDOR_MODE is a module-level constant evaluated at import time, so tests
// flip it through appEnvOverrides.
useAppEnvOverrides({ VENDOR_MODE: 'live' })

const params = {
  audioKey: 'robocall/1/clip.webm',
  contentType: 'audio/webm',
  candidateName: 'Alex Rivera',
  organizationName: 'Rivera for City Council',
  userId: '1',
}

const checks = (over: Partial<Record<string, boolean>> = {}) => ({
  object: {
    hasSelfIdentification: true,
    hasOrganization: true,
    hasCallbackNumber: true,
    ...over,
  },
})

describe('RobocallComplianceService', () => {
  let service: RobocallComplianceService
  let transcription: { transcribe: ReturnType<typeof vi.fn> }
  let llm: { jsonCompletion: ReturnType<typeof vi.fn> }
  let logger: { debug: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    appEnvOverrides.VENDOR_MODE = 'live'
    transcription = { transcribe: vi.fn() }
    llm = { jsonCompletion: vi.fn() }
    const mockLogger = createMockLogger()
    logger = mockLogger as unknown as { debug: ReturnType<typeof vi.fn> }
    service = new RobocallComplianceService(
      mockLogger,
      transcription as unknown as RobocallTranscriptionService,
      llm as unknown as LlmService,
    )
  })

  it('passes a first-name self-ID + reused-name sponsor when the LLM says so', async () => {
    // The LLM (mocked) is what actually judges the transcript against the
    // tolerant prompt — this asserts the service correctly maps an
    // all-true verdict (as the new prompt should return for a first-name
    // self-ID + the candidate's own "[name] for [office]" committee) to a
    // passing result with no issues.
    transcription.transcribe.mockResolvedValue(
      'Hi, this is Alex, candidate for City Council. Paid for by Rivera for City Council. Call 855 749 2163.',
    )
    llm.jsonCompletion.mockResolvedValue(checks())

    const verdict = await service.checkRecording(params)

    expect(verdict.passed).toBe(true)
    expect(verdict.issues).toEqual([])
  })

  it('logs the verdict at debug without breaking the happy path', async () => {
    transcription.transcribe.mockResolvedValue(
      'Hi, this is Alex Rivera running for City Council. Paid for by Rivera for City Council. Call 855 749 2163.',
    )
    llm.jsonCompletion.mockResolvedValue(checks())

    const verdict = await service.checkRecording(params)

    expect(verdict.passed).toBe(true)
    expect(verdict.issues).toEqual([])
    expect(verdict.transcript).toContain('Alex Rivera')
    // The transcript, not the expected values, is what the LLM judged.
    const call = llm.jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0)
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('Rivera for City Council')
    expect(userPrompt).toContain('Alex Rivera')
    // No client-supplied number is fed as the expected value — the check only
    // confirms a callback number is spoken, so nothing is there to spoof.
    expect(userPrompt).not.toMatch(/expected callback number/i)
    expect(logger.debug).toHaveBeenCalledWith(
      { checks: checks().object },
      'Robocall compliance verdict',
    )
  })

  it('fails with one issue per missing element', async () => {
    transcription.transcribe.mockResolvedValue('Hi, this is Alex Rivera.')
    llm.jsonCompletion.mockResolvedValue(
      checks({ hasOrganization: false, hasCallbackNumber: false }),
    )

    const verdict = await service.checkRecording(params)

    expect(verdict.passed).toBe(false)
    expect(verdict.checks.hasOrganization).toBe(false)
    expect(verdict.issues).toHaveLength(2)
    expect(verdict.issues.join(' ')).toMatch(/organization/i)
  })

  it('a spoken number in the transcript passes even when the LLM misses it', async () => {
    for (const spoken of [
      'Call 414-485-8077.',
      'Call 4 1 4 4 8 5 8 0 7 7.',
      'Call four one four, four eight five, eight oh seven seven.',
      'Call +1 (414) 485-8077.',
      'Call four one four. Four eight five. Eight oh seven seven.',
    ]) {
      transcription.transcribe.mockResolvedValue(
        `Hi, this is Alex, candidate for City Council. Paid for by Rivera for City Council. ${spoken}`,
      )
      llm.jsonCompletion.mockResolvedValue(checks({ hasCallbackNumber: false }))

      const verdict = await service.checkRecording(params)

      expect(verdict.passed).toBe(true)
      expect(verdict.issues).toEqual([])
    }
  })

  it('still fails the callback check when no number is spoken', async () => {
    transcription.transcribe.mockResolvedValue(
      'Hi, this is Alex, candidate for City Council. Paid for by Rivera for City Council. Vote on November 3 at 7 am.',
    )
    llm.jsonCompletion.mockResolvedValue(checks({ hasCallbackNumber: false }))

    const verdict = await service.checkRecording(params)

    expect(verdict.passed).toBe(false)
    expect(verdict.checks.hasCallbackNumber).toBe(false)
  })

  it('leaves a date, an amount or a seven-digit number to the LLM', async () => {
    for (const spoken of [
      'Vote on 11/3/2026 between 7 and 8.',
      'We raised $1,500,000 for our schools.',
      'Call 485-8077.',
      'Call four one four o four eight five o eight seven.',
      'Since eight, 2024. One two three four five.',
      'We raised $1,500,000,000 for our schools.',
    ]) {
      transcription.transcribe.mockResolvedValue(
        `Hi, this is Alex, candidate for City Council. Paid for by Rivera for City Council. ${spoken}`,
      )
      llm.jsonCompletion.mockResolvedValue(checks({ hasCallbackNumber: false }))

      const verdict = await service.checkRecording(params)

      expect(verdict.passed).toBe(false)
      expect(verdict.checks.hasCallbackNumber).toBe(false)
    }
  })

  it('an empty transcript is a re-record prompt, not an all-false content fail', async () => {
    // A COMPLETED transcription with no text = silent/truncated upload. It must
    // not run the LLM or read as three "missing element" issues.
    transcription.transcribe.mockResolvedValue('   ')

    const verdict = await service.checkRecording(params)

    expect(verdict.passed).toBe(false)
    expect(verdict.checks).toEqual({
      hasSelfIdentification: false,
      hasOrganization: false,
      hasCallbackNumber: false,
    })
    expect(verdict.issues).toEqual([NO_SPEECH_ISSUE])
    expect(verdict.issues.join(' ')).not.toMatch(/must state|must name/i)
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fail-closed: a transcription failure propagates and never runs the check', async () => {
    transcription.transcribe.mockRejectedValue(new BadGatewayException('down'))

    await expect(service.checkRecording(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fail-closed: an LLM failure surfaces as a 502, not a pass', async () => {
    transcription.transcribe.mockResolvedValue('some transcript')
    llm.jsonCompletion.mockRejectedValue(new Error('all models failed'))

    await expect(service.checkRecording(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('live mode: calls transcription.transcribe with bucket, key, and contentType', async () => {
    transcription.transcribe.mockResolvedValue('some transcript')
    llm.jsonCompletion.mockResolvedValue(checks())

    await service.checkRecording(params)

    expect(transcription.transcribe).toHaveBeenCalledWith({
      bucket: 'robocall-audio-test',
      key: params.audioKey,
      contentType: params.contentType,
    })
  })

  describe('mock mode', () => {
    beforeEach(() => {
      appEnvOverrides.VENDOR_MODE = 'mock'
    })

    it('skips transcription.transcribe and passes a synthesized transcript to the LLM', async () => {
      llm.jsonCompletion.mockResolvedValue(checks())

      await service.checkRecording(params)

      expect(transcription.transcribe).not.toHaveBeenCalled()
      const call = llm.jsonCompletion.mock.calls[0]?.[0]
      const userPrompt = call.messages.find(
        (m: { role: string }) => m.role === 'user',
      )?.content
      expect(userPrompt).toContain(params.candidateName)
      expect(userPrompt).toContain(params.organizationName)
      // The synthesized transcript must include a phone number so the LLM
      // can verify hasCallbackNumber against real content.
      expect(userPrompt).toMatch(/\d[\d\s\-().]{6,}\d/)
    })

    it('still runs the LLM verdict; a failing verdict fails the check', async () => {
      llm.jsonCompletion.mockResolvedValue(
        checks({ hasSelfIdentification: false }),
      )

      const verdict = await service.checkRecording(params)

      expect(verdict.passed).toBe(false)
      expect(verdict.checks.hasSelfIdentification).toBe(false)
      expect(transcription.transcribe).not.toHaveBeenCalled()
    })
  })
})
