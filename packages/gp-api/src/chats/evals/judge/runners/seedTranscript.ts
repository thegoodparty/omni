import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { ChatMessageSegmentKind } from '../../../../generated/prisma'
import {
  ChatStoreService,
  type PersistedSegment,
} from '@/chats/services/chatStore.prisma'
import {
  ChatStreamService,
  MAX_CHAT_HISTORY_MESSAGES,
  toJsonPayload,
} from '@/chats/services/chatStream.service'
import type { SeededTurn } from '../cases'
import { assertTestProcess } from './chatSeam'

// Writes a transcript onto a conversation before the agent is asked anything,
// so a case can be answered MID-conversation rather than from an empty thread.
//
// NO ROUTE WRITES AN ASSISTANT MESSAGE. The assistant row is produced by the
// stream as a side effect of a turn, so there is no HTTP way to put one on the
// record and this has to reach the store directly. That is the whole reason
// the file exists, and it is also the reason it reuses the two methods the
// live turn uses rather than building its own row:
//
//   ChatStoreService.appendUserMessageIfAlive — exactly what
//     ChatStreamService.run calls for the user turn, including its
//     conversation-alive check.
//   ChatStreamService.persistAssistantText   — exactly what a streamed turn
//     calls to write its own reply, including the rule that decides when
//     segments are stored at all.
//
// A HAND-BUILT ROW WOULD BE THE WRONG SHAPE IN WAYS NOBODY WOULD NOTICE, and
// the model's context would then differ from production while the verdict
// claimed to be about the agent we ship. Reusing the two methods makes the
// seeded row identical by construction instead of by inspection.
//
// WHAT REACHES THE MODEL, stated plainly because it is easy to get wrong:
// `toLlmMessages` replays a history row's `role` and `content` and NOTHING
// else. Segments are not replayed. So a seeded tool call changes what the
// client would render and what a reader of the record sees; it does not
// change the model's context. What DOES change the model's context is a
// leading ASSISTANT row, which `toLlmMessages` folds into the system prompt
// instead of sending as an invalid leading turn — so a transcript that opens
// on an assistant reply changes the configDigest as well as the history.

export interface SeedTranscriptRequest {
  conversationId: string
  ownerUserId: number
  turns: readonly SeededTurn[]
  // How many turns the runner is about to drive. Each one adds a user row and
  // an assistant row, and the replay window is finite — see below.
  drivenTurns: number
}

// Every driven turn puts two rows on the record: the user message and the
// assistant reply.
const ROWS_PER_DRIVEN_TURN = 2

// REFUSED BEFORE THE TURN, not discovered during it. The route replays only
// the most recent MAX_CHAT_HISTORY_MESSAGES rows, so a transcript long enough
// to be pushed out of that window by the turns driven after it would be
// written, charged for, and then never shown to the model — and the record
// would claim a mid-conversation condition the agent was never under.
export const transcriptOverflowText = (
  seeded: number,
  drivenTurns: number,
): string | undefined => {
  const rows = seeded + drivenTurns * ROWS_PER_DRIVEN_TURN
  return rows <= MAX_CHAT_HISTORY_MESSAGES
    ? undefined
    : `a prior transcript of ${seeded} row(s) plus ${drivenTurns} driven ` +
        `turn(s) is ${rows} rows, and the route replays only the most ` +
        `recent ${MAX_CHAT_HISTORY_MESSAGES}; the oldest seeded rows would ` +
        'be written and then never reach the model'
}

export class SeedTranscriptError extends Error {}

// Raised BEFORE anything is opened or driven. Called from the runner's
// pre-flight, where nothing has been spent, and again here — one function, so
// a caller that reaches the seeder another way cannot miss it.
export const assertTranscriptFits = (
  seeded: number,
  drivenTurns: number,
): void => {
  const overflow = transcriptOverflowText(seeded, drivenTurns)
  if (overflow !== undefined) throw new SeedTranscriptError(overflow)
}

// The segments a seeded assistant turn carries. Tool calls first and the text
// after, which is the order a real turn produces for the ordinary
// tool-then-answer shape: `onToolCallStart` pushes its segment while the model
// is still deciding, and the text deltas that explain the result arrive after.
// A seeded turn cannot express an interleaving finer than that, and saying so
// here is better than inventing a field for it.
const segmentsFor = (turn: SeededTurn): PersistedSegment[] => [
  ...(turn.toolCalls ?? []).map((call, index) => ({
    kind: ChatMessageSegmentKind.tool,
    toolName: call.tool,
    // The same conversion a streamed turn makes on its way to the same
    // column, rather than a second one that could disagree with it.
    payload: toJsonPayload(call.input),
    // The same shape runScript mints, so a seeded call and a scripted one are
    // not told apart by their ids.
    toolCallId: `judge-seeded-${index}`,
  })),
  ...(turn.content.length > 0
    ? [{ kind: ChatMessageSegmentKind.text, text: turn.content }]
    : []),
]

export const seedPriorTranscript = async (
  app: NestFastifyApplication,
  request: SeedTranscriptRequest,
): Promise<void> => {
  // Writes chat rows against whatever database the app is wired to. Nothing
  // here deletes, and an assistant message nobody's agent wrote is not
  // something to put in a live conversation.
  assertTestProcess('seedPriorTranscript')

  assertTranscriptFits(request.turns.length, request.drivenTurns)

  const store = app.get(ChatStoreService)
  const stream = app.get(ChatStreamService)

  for (const turn of request.turns) {
    if (turn.role === 'user') {
      const row = await store.appendUserMessageIfAlive({
        conversationId: request.conversationId,
        ownerUserId: request.ownerUserId,
        content: turn.content,
      })
      // Null means the conversation is gone or is not this user's, which the
      // live route answers with `conversation_not_found`. Here it means the
      // harness seeded against the wrong conversation, and carrying on would
      // drive a turn with a transcript that is missing its middle.
      if (!row) {
        throw new SeedTranscriptError(
          `conversation ${request.conversationId} is not open for this ` +
            'user, so a prior transcript cannot be written onto it',
        )
      }
      continue
    }
    const row = await stream.persistAssistantText(
      request.conversationId,
      turn.content,
      segmentsFor(turn),
      // A widget-only turn — tool calls, no text — is a real shape and only
      // persists with this set. Without it the row is silently dropped and
      // the transcript loses a turn.
      true,
    )
    if (!row) {
      throw new SeedTranscriptError(
        'an assistant turn with no content and no tool call persists ' +
          'nothing; the case schema refuses one, so reaching here means ' +
          'the two disagree',
      )
    }
  }
}
