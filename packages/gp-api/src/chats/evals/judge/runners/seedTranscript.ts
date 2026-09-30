import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  ChatMessageRole,
  ChatMessageSegmentKind,
} from '../../../../generated/prisma'
import {
  ChatStoreService,
  type PersistedSegment,
} from '@/chats/services/chatStore.prisma'
import {
  assistantRowToPersist,
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
// the file exists, and it is also the reason every rule it writes by is
// borrowed rather than restated:
//
//   ChatStoreService.appendUserMessageIfAlive — exactly what
//     ChatStreamService.run calls for the user turn, including its
//     conversation-alive check.
//   assistantRowToPersist                     — the decision
//     ChatStreamService.persistAssistantText makes about what an assistant
//     turn stores: the content, and whether the segments are worth keeping.
//   ChatStoreService.appendMessage             — the one write both that
//     method and this one end in.
//   toJsonPayload                              — the conversion a streamed
//     tool call makes on its way to the same column.
//
// A HAND-BUILT ROW WOULD BE THE WRONG SHAPE IN WAYS NOBODY WOULD NOTICE, and
// the model's context would then differ from production while the verdict
// claimed to be about the agent we ship. Borrowing the rules makes the seeded
// row identical by construction instead of by inspection.
//
// `persistAssistantText` itself stays PRIVATE on the service. It is the one
// write in the chat stack with no ownership check on it, and what this file
// needs is the rules, not the ability to put an assistant row into an
// arbitrary conversation. The ownership check this file does need it makes
// once, below.
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

// A scope whose handler seeds a scripted opener (campaign_assistant) has one
// assistant row on the conversation before this runs. Counted
// unconditionally: the seeder is handed a conversation id and not a scope, and
// one row of pessimism is cheaper than a window this arithmetic quietly
// overshoots on one scope out of four.
const SCOPE_OPENER_ROWS = 1

// REFUSED BEFORE THE TURN, not discovered during it. The route replays only
// the most recent MAX_CHAT_HISTORY_MESSAGES rows, so a transcript long enough
// to be pushed out of that window by the turns driven after it would be
// written, charged for, and then never shown to the model — and the record
// would claim a mid-conversation condition the agent was never under.
export const transcriptOverflowText = (
  seeded: number,
  drivenTurns: number,
): string | undefined => {
  const rows = seeded + drivenTurns * ROWS_PER_DRIVEN_TURN + SCOPE_OPENER_ROWS
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
export const segmentsFor = (
  turn: SeededTurn,
  turnIndex: number,
): PersistedSegment[] => [
  ...(turn.toolCalls ?? []).map((call, index) => ({
    kind: ChatMessageSegmentKind.tool,
    toolName: call.tool,
    // The same conversion a streamed turn makes on its way to the same
    // column, rather than a second one that could disagree with it.
    payload: toJsonPayload(call.input),
    // The TURN's index as well as the call's, because `toolCallId` is what a
    // chat card's outreach id is derived from and two seeded turns each
    // carrying one call would otherwise both be `judge-seeded-0` in one
    // conversation. `appendMessage` does not write the column today, so this
    // is parity with the segment the stream BUILDS rather than with a row
    // anybody can read back — which is also why it is unit-tested here and
    // not asserted against the database.
    toolCallId: `judge-seeded-${turnIndex}-${index}`,
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
  // ONCE, UP FRONT, because the assistant write below has no check of its
  // own: `appendMessage` takes a conversation id and trusts it. A transcript
  // that opens on an assistant turn would otherwise put a reply nobody's
  // agent wrote into whatever conversation that id names.
  const owned = await store.findConversationByIdAndOwner(
    request.conversationId,
    request.ownerUserId,
  )
  if (!owned) {
    throw new SeedTranscriptError(
      `conversation ${request.conversationId} is not open for this user, ` +
        'so a prior transcript cannot be written onto it',
    )
  }

  for (const [turnIndex, turn] of request.turns.entries()) {
    if (turn.role === 'user') {
      const row = await store.appendUserMessageIfAlive({
        conversationId: request.conversationId,
        ownerUserId: request.ownerUserId,
        content: turn.content,
      })
      // Null means the conversation was deleted between the check above and
      // this write. Carrying on would drive a turn against a transcript
      // missing its middle.
      if (!row) {
        throw new SeedTranscriptError(
          `conversation ${request.conversationId} is not open for this ` +
            'user, so a prior transcript cannot be written onto it',
        )
      }
      continue
    }
    const assistant = assistantRowToPersist(
      turn.content,
      segmentsFor(turn, turnIndex),
      // A widget-only turn — tool calls, no text — is a real shape and only
      // persists with this set. Without it the row is dropped and the
      // transcript loses a turn.
      true,
    )
    if (!assistant) {
      throw new SeedTranscriptError(
        'an assistant turn with no content and no tool call persists ' +
          'nothing; the case schema refuses one, so reaching here means ' +
          'the two disagree',
      )
    }
    await store.appendMessage({
      conversationId: request.conversationId,
      role: ChatMessageRole.assistant,
      ...assistant,
    })
  }
}
