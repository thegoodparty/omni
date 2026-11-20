# Client hookup — chat routes

How to wire a frontend (gp-webapp, or any other client) to the chat surface. The shared contract here applies to every chat kind. Per-kind routes are listed below; future kinds (campaign-strategy-chats, etc.) follow the same conventions.

## Routes

### Briefing chats — annotation-keyed create and delete

```
POST   /v1/briefing-chats        # creates the Annotation and its ChatConversation
DELETE /v1/briefing-chats/:annotationId   # 204 soft-delete
```

A briefing conversation is created with its `Annotation` in one transaction:
`POST /v1/briefing-chats {meetingDate, anchor}` returns `{ annotationId,
conversationId }` and finds-or-creates the top-level pair for that briefing.
`/v1/chats` refuses the `briefing_annotation` scope on purpose, because a
conversation no annotation points at is one the briefing context cannot load.
`DELETE` stays annotation-keyed because the briefing UI deletes the chat row it
renders, and that row is the annotation.

Turns and history are **conversation-keyed**, the same routes every other scope
uses — pass the `conversationId` the create returned with
`scope=briefing_annotation`.

### Chats — scope-keyed

```
POST   /v1/chats                                  # create a conversation for a scope
GET    /v1/chats?scope=chief_of_staff             # history list (conversations + titles)
POST   /v1/chats/:conversationId/messages?scope=… # SSE, sends a user message
GET    /v1/chats/:conversationId?scope=…          # conversation + history (replay)
DELETE /v1/chats/:conversationId?scope=…          # 204 soft-delete

PUT    /v1/chats/:conversationId/messages/:messageId/feedback?scope=…  # rate a reply
DELETE /v1/chats/:conversationId/messages/:messageId/feedback?scope=…  # 204 retract
```

Scope-generic surface. Registered scopes: `chief_of_staff`,
`campaign_assistant`, `ordinance_flow`, `priority_flow` and
`briefing_annotation`. Every route requires the `X-Organization-Slug` header,
and ownership is checked by `(owner, scope, organizationSlug)`. `scope` is a
required query param on every route except `POST /v1/chats`, where it is in the
body. `POST /v1/chats` creates a NEW conversation on every call and returns
`{ conversationId, created }`; resuming a past thread is opening it by id.
The first user message auto-titles the conversation (truncated to 80 chars),
except in a scope that declares `setsTitle === false` — briefing chat keeps the
name its annotation gives it. The SSE chunk shapes and error codes are
identical for every scope (see below).

## Authentication

All routes use the standard gp-api session guard. Pass the session cookie (JWT) the way the rest of the app does. For server-to-server / testing, a Clerk M2M token works (`Authorization: Bearer mt_...`).

## POST `:conversationId/messages` — sending a message

Request body:

```json
{
  "content": "What's the controversy on agenda item 2?",
  "id": "9c2d8e1f-3b4a-4c5d-8e9f-0a1b2c3d4e5f"
}
```

| Field             | Required | Notes                                                                          |
| ----------------- | -------- | ------------------------------------------------------------------------------ |
| `content`         | yes      | Trimmed; max 10,000 chars; empty rejected with 400                             |
| `id`              | optional | UUID. **Strongly recommended** — it is the stored turn's id. See below         |
| `clientMessageId` | optional | The old name for `id`; still accepted for one release. Use `id` in new code.   |

Response is **SSE** (`Content-Type: text/event-stream`). Each frame is `data: <JSON>\n\n`. The JSON shape is one of:

| Type          | Fields                                                      | Meaning                                                                                                       |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `text`        | `{ type: 'text', delta: string }`                           | Token-by-token assistant output. Append to a buffer.                                                          |
| `tool_call`   | `{ type: 'tool_call', toolName: string, args: object }`     | The LLM invoked a tool. Show "thinking" / "searching" UI if you want.                                         |
| `tool_result` | `{ type: 'tool_result', toolName: string, result: object }` | Tool finished.                                                                                                |
| `done`        | `{ type: 'done', assistantMessageId?: string }`             | Stream complete. `assistantMessageId` may be omitted if persistence failed; don't depend on it being present. |
| `error`       | `{ type: 'error', code, message, retryable }`               | Stream failed. See error codes below.                                                                         |

Always handle `done` and `error` as terminal — close the stream and stop reading.

### Error codes

| `code`                   | `retryable` | When                                                               | Suggested UI                                             |
| ------------------------ | ----------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `conversation_not_found` | false       | No conversation for that id under the caller's owner + scope + org | "This chat is unavailable. Refresh the briefing."        |
| `upstream_unavailable`   | true        | LLM provider 5xx / network failure                                 | "Chat is temporarily unavailable. Retry?" + retry button |
| `rate_limited`           | true        | LLM provider 429                                                   | "Too many requests. Try again in a moment." + retry      |
| `aborted`                | false       | Client closed connection or server cancelled                       | Show nothing (user did it themselves).                   |
| `internal`               | false       | Anything else server-side                                          | "Something went wrong. Please refresh."                  |

Always show `message` to the user — it's already sanitized server-side (no stack traces, no internal model names, no provider URLs).

## Idempotency — `id`

**Rule: one UUID per logical send. New send → new UUID. Network retry of the same send → reuse the same UUID.**

The id you send becomes the stored user turn's primary key. That is the whole mechanism: a second delivery of the same send collides on the key, so the server replays the reply that turn produced instead of running the model again.

```ts
const id = crypto.randomUUID()

async function send(content: string) {
  try {
    return await postMessage({ content, id })
  } catch (err) {
    if (isRetryable(err)) {
      // reuse the same id — the server finds the stored turn
      return await postMessage({ content, id })
    }
    throw err
  }
}
```

What this prevents:

- **Double-click on Send** — two POSTs with the same `id` → one user turn, one LLM stream. (Best UX is still to disable the Send button while the request is in flight; idempotency is a backstop.)
- **Network-retry mid-send** — client times out, retries → same id → the server replays the stored reply instead of running the LLM twice.

An id that is already a *different* turn's (another conversation, another user, or an assistant row) is rejected with **409**, and the message says nothing about the row that holds it. Reusing an id for a different send is a client bug: mint a new UUID.

If you omit `id` you get the old non-idempotent behavior. Use it.

## Abort / disconnect

Pass a fetch `AbortSignal` to your request. Closing the connection (`controller.abort()`, navigating away, closing the tab) is detected server-side: the SSE generator stops, the LLM stream is cancelled, partial text is persisted, and a final `done` chunk is yielded with `code: 'aborted'` if you're still listening (you usually aren't, since you aborted).

There's also a **300-second server-side timeout** per stream. If the LLM hangs, the server forces abort on its side.

## GET `:conversationId` — load history

```json
{
  "conversationId": "ckg...",
  "scope": "briefing_annotation",
  "title": null,
  "messages": [
    {
      "id": "...",
      "role": "user",
      "content": "...",
      "createdAt": "2026-05-14T..."
    },
    { "id": "...", "role": "assistant", "content": "...", "createdAt": "..." }
  ],
  "usage": {
    "complete": true,
    "byModel": [
      { "model": "claude-sonnet-4-6", "inputTokens": 1200, "outputTokens": 340 }
    ]
  }
}
```

Messages are ordered by `createdAt` ascending. Returns 404 if the conversation has been soft-deleted. Returns 404 (not 403) for cross-user access — no existence leak.

`usage` (on this route and `GET /v1/chats/:conversationId`) sums every assistant turn's tokens by the model that answered, and is written before the turn's `done` frame, so a GET right after `done` includes it. A reply written without an LLM call (the Campaign Manager greeting, canned replies) counts as 0 tokens with no model row; `complete` is false when any assistant turn has unknown usage (an interrupted turn, or a failed usage write), so treat the totals as a floor.

An assistant message the caller has rated also carries `feedback: { feedback, comment }`. The field is absent when they haven't rated it, and only ever reflects the caller's own rating — one user never sees another's.

## Message feedback — `PUT`/`DELETE` `:conversationId/messages/:messageId/feedback`

Thumbs up / thumbs down on one assistant reply, plus the optional note explaining it. Rows key on `(user, message)` and also store the conversation id, so the rating can be read back per message or per thread.

`PUT` body:

```json
{ "feedback": "negative", "comment": "Missed the budget item." }
```

| Field      | Required | Notes                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `feedback` | yes      | `positive` \| `negative`                                                                                           |
| `comment`  | optional | Max 2,000 chars. **Omit** it to keep whatever note is stored (a re-vote without retyping); pass `null` to clear it |

`PUT` is an upsert, so repeating it replaces the rating rather than stacking rows, and it returns the stored row. `DELETE` retracts the rating and its note (204, and idempotent — retracting nothing still succeeds).

Both 404 on a `messageId` that isn't an **assistant** turn of that conversation, so a user turn and a message borrowed from another thread are both rejected rather than writing an orphan row. `scope` is required on both, same as the other routes.

## DELETE — soft-delete

`DELETE /v1/chats/:conversationId?scope=…` and
`DELETE /v1/briefing-chats/:annotationId` both return 204 No Content and
soft-delete the underlying `ChatConversation` (set `deletedAt`). After deletion:

- `GET` returns 404
- `POST` returns `conversation_not_found` over SSE

A briefing's delete also removes the annotation that pointed at the
conversation. Soft-delete is **not reversible** through our API. If a user wants
to start a fresh chat on the same highlight, the flow needs to delete and
re-create (which mints a fresh `ChatConversation`).

## Models

The model fallback chain is `claude-sonnet-4-6` → `claude-opus-4-7`. Hardcoded in `src/chats/briefing-chats/briefingAnnotation.handler.ts` (`BRIEFING_CHAT_MODELS`). Client doesn't pick the model.

## Example consumer (vanilla fetch + SSE parse)

```ts
const messageId = crypto.randomUUID()
const controller = new AbortController()

const res = await fetch(
  `/api/v1/chats/${conversationId}/messages?scope=briefing_annotation`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Slug': orgSlug,
    },
    body: JSON.stringify({ content, id: messageId }),
    signal: controller.signal,
  },
)

if (!res.ok) {
  // 4xx/5xx before stream starts — read JSON body for error
  throw new Error(`HTTP ${res.status}`)
}

const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
let assistantText = ''

while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  // SSE frames are separated by \n\n
  const frames = buf.split('\n\n')
  buf = frames.pop() ?? ''
  for (const frame of frames) {
    if (!frame.startsWith('data: ')) continue
    const chunk = JSON.parse(frame.slice(6))
    switch (chunk.type) {
      case 'text':
        assistantText += chunk.delta
        renderPartial(assistantText)
        break
      case 'tool_call':
        renderToolThinking(chunk.toolName)
        break
      case 'tool_result':
        /* optional, usually ignored in UI */ break
      case 'done':
        finalize(assistantText, chunk.assistantMessageId)
        return
      case 'error':
        showError(chunk)
        return
    }
  }
}
```

## Quick checklist before shipping

- [ ] Generate a fresh `id` per send; reuse it on retry
- [ ] Disable Send while a stream is in flight (don't rely on idempotency alone)
- [ ] Handle all five error codes (different UX per `retryable`)
- [ ] Wire `AbortController` to component unmount / navigation
- [ ] Treat `done` and `error` as terminal — close the reader
- [ ] Auto-scroll on `text` chunks but only if the user is at the bottom (standard chat pattern)
