import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'

// Deliberately looser than ConstituentFeedbackStance: this is unvalidated
// model output, and a stance outside our vocabulary is worth storing and
// seeing rather than rejecting into a retry loop.
const RawExtractionSchema = z.object({
  issueLabel: z.string().nullable(),
  stance: z.string().nullable(),
  desiredOutcome: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
})

export type RawExtraction = z.infer<typeof RawExtractionSchema>

const SYSTEM_PROMPT = `You read short spoken notes that a canvasser recorded
just after talking with a constituent, and you pull out three things.

The voice in the note is the CANVASSER describing someone else. "He is against
the cameras" means the constituent opposes them, never the canvasser. Never
attribute the canvasser's own words to the constituent.

Return three fields.

issueLabel: the thing the constituent talked about, as a short noun phrase a
person would recognise on a list. "Flock cameras", "street flooding",
"composting pilot". Not a sentence. Not a category you invented to be tidy —
use the words the note uses. Null if the note names no issue.

stance: where the CONSTITUENT stands on that issue. Exactly one of "supports",
"opposes", "mixed", "unclear". Use "mixed" for a settled position with
reservations, such as backing a programme but disliking part of it. Use
"unclear" when the note records a conversation but no position. Null only if
there is no issue at all.

desiredOutcome: what the constituent said they want to happen. The change
itself, not the reason behind it. "Remove the cameras and delete the collected
data", "a smaller kitchen bin". Null when the note records no ask. Most notes
have no ask, and null is the correct answer far more often than a guess is.

Never infer beyond the note. A note that says only "spoke to Bob, nice guy"
has no issue, no stance and no outcome, and three nulls is the right reading.

confidence: 0 to 1, your own read on whether a person who heard the same
conversation would agree with the fields above.`

const buildUserPrompt = (input: {
  transcript: string
  effortQuestion: string | null
}): string =>
  input.effortQuestion
    ? `The canvasser was asking constituents: ${input.effortQuestion}\n\nTheir note:\n${input.transcript}`
    : `The canvasser's note:\n${input.transcript}`

@Injectable()
export class ConstituentFeedbackExtractionService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConstituentFeedbackExtractionService.name)
  }

  // Returns null rather than throwing: the transcript is the record worth
  // keeping, and a failed extraction leaves the canvasser an empty triple to
  // fill in instead of losing the memo they just recorded.
  async extract(input: {
    transcript: string
    effortQuestion: string | null
    userId: number
  }): Promise<{ extraction: RawExtraction; model: string } | null> {
    try {
      const { object, model } = await this.llm.jsonCompletion({
        schema: RawExtractionSchema,
        userId: String(input.userId),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      })
      return { extraction: object, model }
    } catch (err) {
      this.logger.error({ err }, 'Constituent feedback extraction failed')
      return null
    }
  }
}
