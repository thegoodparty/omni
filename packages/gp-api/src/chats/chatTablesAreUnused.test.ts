import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Chat reads and writes only AgentMessage. `ChatMessage` and
// `ChatMessageSegment` used to be tables, and the code that used them was
// removed a deploy before the tables were dropped, so that no task serving
// during the drop's rollout could read them. That ordering is what made the
// drop safe, and it is invisible in a diff: Prisma names every mapped column in
// its SELECTs, so a single leftover query would have failed mid-rollout rather
// than at build time.
//
// This test keeps it that way. It scans for the ways code used to reach the old
// store — the Prisma delegates, and the `messages` relation on ChatConversation,
// which read chat_message rather than agent_message — and checks the models are
// gone from the schema, so a partial revert cannot bring back half of it.
const SRC = resolve(__dirname, '..')
const SCHEMA_DIR = resolve(SRC, '../prisma/schema')

const IGNORED_DIRS = new Set(['node_modules', 'generated'])

const isTestFile = (path: string): boolean =>
  /\.(test|spec)\.ts$/.test(path) || path.endsWith('.d.ts')

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return IGNORED_DIRS.has(entry) ? [] : tsFilesUnder(path)
    }
    return path.endsWith('.ts') && !isTestFile(path) ? [path] : []
  })

// Any access to the delegate, whatever it hangs off (`prisma.chatMessage`,
// `this.model.chatMessageSegment`), plus the MODELS constant that names one.
// A commented-out mention still counts: the point is that no reviewer has to
// judge whether a given line is live. `\b` keeps the Feedback model, whose
// name starts the same way, out of it.
const OLD_DELEGATE =
  /\.\s*(chatMessage|chatMessageSegment)\b|\bMODELS\s*\.\s*(ChatMessage|ChatMessageSegment)\b/g

// The relation, not the string "messages": a filter on ChatConversation's
// `messages` reads chat_message. Whitespace-tolerant so a query split across
// lines is still caught.
const MESSAGES_RELATION = /\bmessages\s*:\s*\{/g

// Only files that actually build a ChatConversation query can be matching the
// relation rather than some unrelated `messages` field, so scope that one to
// calls on the conversation model and its own service base.
const CONVERSATION_QUERY = /\bchatConversation\s*\.|MODELS\.ChatConversation/

describe('nothing outside the migrations uses the dropped chat tables', () => {
  it('never calls the ChatMessage or ChatMessageSegment delegates', () => {
    const offenders = tsFilesUnder(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(OLD_DELEGATE)].map(
        (match) => `${relative(SRC, file)} uses ${match[0]}`,
      ),
    )

    expect([...new Set(offenders)]).toEqual([])
  })

  it('never filters a conversation on the ChatConversation `messages` relation', () => {
    const offenders = tsFilesUnder(SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      if (!CONVERSATION_QUERY.test(source)) return []
      return [...source.matchAll(MESSAGES_RELATION)].map(
        (match) => `${relative(SRC, file)} uses ${match[0]}`,
      )
    })

    expect([...new Set(offenders)]).toEqual([])
  })

  it('has no ChatMessage or ChatMessageSegment model left to reach', () => {
    const schema = readdirSync(SCHEMA_DIR)
      .filter((entry) => entry.endsWith('.prisma'))
      .map((entry) => readFileSync(join(SCHEMA_DIR, entry), 'utf8'))
      .join('\n')

    expect(schema).not.toMatch(/^model ChatMessage \{/m)
    expect(schema).not.toMatch(/^model ChatMessageSegment \{/m)
  })
})
