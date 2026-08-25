import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import { RobocallComplianceService } from './robocallCompliance.service'
import { RobocallTranscriptionService } from './robocallTranscription.service'

const params = {
  audioKey: 'robocall/1/clip.webm',
  contentType: 'audio/webm',
  candidateName: 'Alex Rivera',
  organizationName: 'Rivera for City Council',
  callbackNumber: '18557492163',
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

  beforeEach(() => {
    transcription = { transcribe: vi.fn() }
    llm = { jsonCompletion: vi.fn() }
    service = new RobocallComplianceService(
      createMockLogger(),
      transcription as unknown as RobocallTranscriptionService,
      llm as unknown as LlmService,
    )
  })

  it('passes when all disclosure elements are present', async () => {
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
})
