import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import {
  RobocallComplianceService,
  SYSTEM_PROMPT,
} from './robocallCompliance.service'
import { RobocallTranscriptionService } from './robocallTranscription.service'

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

  it('prompt tolerates first-name self-ID and name transcription noise', () => {
    expect(SYSTEM_PROMPT).toMatch(/first-name-only/i)
    expect(SYSTEM_PROMPT).toMatch(/transcription variance|variation/i)
    expect(SYSTEM_PROMPT).toMatch(/own name as the sponsor/i)
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
})
