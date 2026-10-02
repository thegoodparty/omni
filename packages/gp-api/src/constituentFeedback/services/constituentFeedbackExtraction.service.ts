import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CONSTITUENT_FEEDBACK_MAX_ISSUES } from '@goodparty_org/contracts'
import { LlmService } from '@/llm/services/llm.service'

// Deliberately looser than ConstituentFeedbackStance: this is unvalidated
// model output, and a stance outside our vocabulary is worth storing and
// seeing rather than rejecting into a retry loop.
const RawExtractionSchema = z.object({
  issues: z
    .array(
      z.object({
        issueLabel: z.string(),
        stance: z.string().nullable(),
        desiredOutcome: z.string().nullable(),
      }),
    )
    .max(CONSTITUENT_FEEDBACK_MAX_ISSUES),
  confidence: z.number().min(0).max(1).nullable(),
})

export type RawExtraction = z.infer<typeof RawExtractionSchema>

// Product-neutral on purpose. The same issues land on a voter's record
// and a constituent's, and the copy around them is mode-keyed by the UI; a
// product noun here steers the model into writing one product's word into
// the other's record.
const SYSTEM_PROMPT = `You read short spoken notes that a canvasser recorded
just after talking with someone, at their door or on the phone, and you pull
out the issues the person raised.

The voice in the note is the CANVASSER describing someone else. "He is against
the cameras" means the person they spoke with opposes them, never the
canvasser. Never attribute the canvasser's own words to the person they spoke
with.

Return issues: one entry per distinct issue the person raised, in the order
they came up, up to five. Most notes name one. Two mentions of the same thing
are one issue. An empty list is the right answer when the note names no
issue. Each entry has three fields.

issueLabel: the thing the person talked about, as a short noun phrase anyone
would recognise on a list. "Flock cameras", "street flooding", "composting
pilot". Not a sentence. Not a category you invented to be tidy — use the words
the note uses.

stance: where THE PERSON THEY SPOKE WITH stands on that issue. Exactly one of
"supports", "opposes", "mixed", "unclear". Use "mixed" for a settled position
with reservations, such as backing a programme but disliking part of it. Use
"unclear" when the note records the issue but no position on it.

desiredOutcome: what the person said they want to happen about that issue.
The change itself, not the reason behind it. "Remove the cameras and delete
the collected data", "a smaller kitchen bin". Null when the note records no
ask. Most issues have no ask, and null is the correct answer far more often
than a guess is.

Never infer beyond the note. A note that says only "spoke to Bob, nice guy"
names no issue, and an empty list is the right reading.

confidence: 0 to 1, your own read on whether someone who heard the same
conversation would agree with the issues above.`

const buildUserPrompt = (input: {
  transcript: string
  effortQuestion: string | null
}): string =>
  input.effortQuestion
    ? `The canvasser was asking each person: ${input.effortQuestion}\n\nTheir note:\n${input.transcript}`
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
  // keeping, and a failed extraction leaves the canvasser an empty issue to
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
