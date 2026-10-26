import { BadGatewayException, Injectable } from '@nestjs/common'
import {
  RobocallComplianceChecks,
  RobocallComplianceChecksSchema,
  RobocallComplianceVerdict,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
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

// An empty transcript means the upload was silent or truncated (nothing to
// transcribe), not a content failure of the three disclosure checks. Surface
// a re-record prompt instead of three false "missing element" issues.
export const NO_SPEECH_ISSUE =
  "We couldn't hear any speech in your recording. Record again and check " +
  'that your microphone is on.'

// The spoken-number check must not hinge on the LLM alone: a number read aloud
// is transcribed as digits ("414-485-8077", "4144858077") or as spoken digit
// words ("four one four ..."), and the model sometimes marks it missing (ENG-11359).
// This backstop overrides the FCC gate, so it only accepts the shape of a US
// number: 3, 3 and 4 digits. Inside a group, digits may only be spaced or
// hyphenated; between groups Transcribe may also put a dot, a comma or
// parentheses. Counting digits instead let a date, an amount or digits
// spread across sentences ("eight, 2024. One two three four five") stand in
// for a number. Anything else, including a seven-digit local number, is left
// to the LLM.
const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
}
const SPOKEN_DIGIT_WORD = new RegExp(
  `\\b(${Object.keys(SPOKEN_DIGITS).join('|')})\\b`,
  'g',
)
const digitGroup = (size: number): string => `\\d(?:[\\s-]*\\d){${size - 1}}`
const GROUP_GAP = '[\\s.,-]*'
const US_PHONE_NUMBER = new RegExp(
  `(?<!\\d)(?:\\+?1${GROUP_GAP})?\\(?${digitGroup(3)}\\)?${GROUP_GAP}` +
    `${digitGroup(3)}${GROUP_GAP}${digitGroup(4)}(?!\\d)`,
)

export const transcriptStatesPhoneNumber = (transcript: string): boolean =>
  US_PHONE_NUMBER.test(
    transcript
      .toLowerCase()
      .replace(SPOKEN_DIGIT_WORD, (word) => SPOKEN_DIGITS[word] ?? word),
  )

interface ComplianceParams {
  audioKey: string
  contentType: string
  candidateName: string
  organizationName: string
  userId: string
}

// In mock mode (previews, tests, local) Transcribe is skipped: a fixture
// recording can't speak a fresh test user's name, so the transcript is built
// from the expected values and the real LLM verdict still runs on it.
const mockTranscript = (params: ComplianceParams): string =>
  `Hi, this is ${params.candidateName} running for office. ` +
  `Paid for by ${params.organizationName}. ` +
  `Questions? Call us back at 555-123-4567.`

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
    const transcript =
      VENDOR_MODE === 'mock'
        ? mockTranscript(params)
        : await this.transcription.transcribe({
            bucket: this.bucket,
            key: params.audioKey,
            contentType: params.contentType,
          })

    if (transcript.trim() === '') {
      this.logger.warn(
        { audioKey: params.audioKey },
        'Robocall recording had no detectable speech',
      )
      return {
        passed: false,
        checks: {
          hasSelfIdentification: false,
          hasOrganization: false,
          hasCallbackNumber: false,
        },
        transcript,
        issues: [NO_SPEECH_ISSUE],
      }
    }

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

    const verdict = await this.runVerdict(messages, params.userId)
    // A number demonstrably in the transcript wins over a model "false".
    const checks = {
      ...verdict,
      hasCallbackNumber:
        verdict.hasCallbackNumber || transcriptStatesPhoneNumber(transcript),
    }

    // Log only the boolean checks, never the transcript — it contains PII (the
    // spoken callback number, the candidate name). The full transcript is still
    // returned in the verdict for client-side debugging.
    this.logger.debug({ checks }, 'Robocall compliance verdict')

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
