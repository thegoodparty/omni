import { BadGatewayException, Injectable } from '@nestjs/common'
import {
  RobocallComplianceChecks,
  RobocallComplianceChecksSchema,
  RobocallComplianceVerdict,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { RobocallTranscriptionService } from './robocallTranscription.service'

export const SYSTEM_PROMPT = [
  'You verify that a recorded political robocall meets FCC calling-disclosure',
  'rules. You are given the transcript and the expected candidate name and',
  'organization. Decide, strictly from what the transcript actually says,',
  'whether each element is present. The transcript comes from automated',
  'speech-to-text on a proper name, which frequently mis-spells, mis-splits,',
  'or garbles it — judge names by reasonable phonetic/spelling similarity to',
  'the expected name, not exact string matching:',
  '- hasSelfIdentification: the speaker identifies themselves by a name that',
  '  reasonably matches the expected candidate name — a first-name-only',
  '  identification is enough, and minor transcription variation on the name',
  '  is fine — AND indicates they are running for or seeking office (e.g.',
  '  "candidate for", "running for", "seeking"). The full legal name is not',
  '  required to appear verbatim.',
  '- hasOrganization: the call states who is responsible for / paid for it.',
  '  For an independent candidate this is commonly their own campaign or',
  '  committee, named as "[candidate] for [office]" — reusing the',
  "  candidate's own name as the sponsor counts. A distinct, separate",
  '  organization is not required. Allow the same name-transcription',
  '  variance as above.',
  '- hasCallbackNumber: a callback phone number is spoken (any phone number in',
  '  any spoken form — digits or grouped). There is no expected number to',
  '  match; only confirm that a number is actually stated.',
  'This tolerance is only for transcription noise on names and for a',
  'first-name-only self-ID — if an element is genuinely absent from the',
  'transcript, mark it false.',
].join('\n')

// Typed tuples (not a Record + Object.keys) so the keys keep their literal
// type when we filter/map without an unsafe cast.
const CHECK_ISSUES: [keyof RobocallComplianceChecks, string][] = [
  [
    'hasSelfIdentification',
    'The recording must state your name and that you are running for office.',
  ],
  [
    'hasOrganization',
    'The recording must name the organization behind the call.',
  ],
  ['hasCallbackNumber', 'The recording must state the callback number.'],
]

interface ComplianceParams {
  audioKey: string
  contentType: string
  candidateName: string
  organizationName: string
  userId: string
}

// Fail-closed compliance gate: transcribe the recording, then confirm (via the
// LLM, temperature 0) that the required disclosures are actually spoken. A
// transcription or LLM failure propagates as a 502 — it never silently passes.
@Injectable()
export class RobocallComplianceService {
  private readonly bucket: string

  constructor(
    private readonly logger: PinoLogger,
    private readonly transcription: RobocallTranscriptionService,
    private readonly llm: LlmService,
  ) {
    this.logger.setContext(RobocallComplianceService.name)
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    this.bucket = bucket
  }

  async checkRecording(
    params: ComplianceParams,
  ): Promise<RobocallComplianceVerdict> {
    const transcript = await this.transcription.transcribe({
      bucket: this.bucket,
      key: params.audioKey,
      contentType: params.contentType,
    })

    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Expected candidate name: ${params.candidateName}`,
          `Expected organization: ${params.organizationName}`,
          'Transcript:',
          '"""',
          transcript,
          '"""',
        ].join('\n'),
      },
    ]

    const checks = await this.runVerdict(messages, params.userId)

    this.logger.debug({ checks, transcript }, 'Robocall compliance verdict')

    const issues = CHECK_ISSUES.filter(([key]) => !checks[key]).map(
      ([, message]) => message,
    )

    return { passed: issues.length === 0, checks, transcript, issues }
  }

  private async runVerdict(
    messages: LlmMessage[],
    userId: string,
  ): Promise<RobocallComplianceChecks> {
    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: RobocallComplianceChecksSchema,
        temperature: 0,
        maxTokens: 256,
        userId,
      })
      return object
    } catch (err) {
      // Fail-closed: a verdict we couldn't compute is a 502, never a pass.
      this.logger.error({ err }, 'Robocall compliance verdict failed')
      throw new BadGatewayException('Robocall compliance check failed')
    }
  }
}
