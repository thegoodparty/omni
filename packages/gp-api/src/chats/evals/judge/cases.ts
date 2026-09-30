import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  AgentShapeSchema,
  JsonValueSchema,
  type AgentShape,
  type JsonValue,
} from './record'
import type { AgentEntry } from './agents'

// Loads an agent's inputs. One file per agent, authored per agent rather than
// coded, which is the property that makes wiring the twenty-first agent a case
// list plus a registry line.
//
// JSON rather than YAML. The TDD says YAML and also says a parser dependency
// is whichever track needs one to add; gp-api has no YAML parser and a case
// list is a flat list of strings, so JSON buys the same thing for free. The
// shape below is what a YAML file would have to deserialize to anyway, so
// swapping the reader later is a change to `parseCaseList`'s one caller.

// A caseId becomes a path segment in the record store and half of a record's
// `runId`, so it is held to the segment alphabet HERE, at the boundary where
// the file that carries it can be named. The store validates again — it has
// to, since it takes records from a runner too — but by then the error can
// only name a record.
const CASE_ID = /^[A-Za-z0-9_-]+$/

const CaseIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    CASE_ID,
    'a caseId becomes a path segment in the record store, so it may ' +
      'contain only letters, digits, underscore and hyphen',
  )

export const ChatCaseSchema = z.object({
  caseId: CaseIdSchema,
  // The turn the agent is asked to take.
  question: z.string().min(1),
})
export type ChatCase = z.infer<typeof ChatCaseSchema>

export const BackgroundCaseSchema = z.object({
  caseId: CaseIdSchema,
  // The parameters fixture the experiment is dispatched with. Opaque here for
  // the same reason a record's input is opaque: only the runner knows what an
  // experiment's params mean.
  params: z.record(z.string(), JsonValueSchema),
})
export type BackgroundCase = z.infer<typeof BackgroundCaseSchema>

export type JudgeCase = ChatCase | BackgroundCase

const CASE_SCHEMAS = {
  chat: ChatCaseSchema,
  background: BackgroundCaseSchema,
} as const

// `placeholder` is carried through to the report on purpose. A verdict drawn
// from a list somebody wrote to exercise the pipeline is not the same claim as
// one drawn from a list somebody wrote to test the agent, and the difference
// is invisible once it is a number in a table.
const CaseListEnvelopeSchema = z.object({
  agentId: z.string().min(1),
  shape: AgentShapeSchema,
  placeholder: z.boolean().optional(),
  note: z.string().min(1).optional(),
  cases: z.array(z.record(z.string(), JsonValueSchema)).min(1),
})

export interface CaseList {
  agentId: string
  shape: AgentShape
  placeholder: boolean
  note?: string
  cases: JudgeCase[]
  // Where it came from, so an error downstream of here can still name the
  // file rather than only the case.
  source: string
}

export class CaseListError extends Error {}

// One place, because this sentence is what goes in front of a person after a
// paid-for sweep failed, and four copies of it drift.
export const describeIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')

// Takes the text rather than the path so the whole parser is testable without
// a fixture file, and so the one place that reads the filesystem is below.
export const parseCaseList = (
  source: string,
  text: string,
  expected: { agentId: string; shape: AgentShape },
): CaseList => {
  // Every JSON.parse result is a JsonValue by construction, so this schema
  // cannot reject one; it is here to give the value a type that is not `any`.
  let json: JsonValue
  try {
    json = JsonValueSchema.parse(JSON.parse(text))
  } catch (err) {
    throw new CaseListError(
      `${source}: not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  const envelope = CaseListEnvelopeSchema.safeParse(json)
  if (!envelope.success) {
    throw new CaseListError(
      `${source}: not a case list — ${describeIssues(envelope.error.issues)}`,
    )
  }

  // Checked rather than trusted, because the registry is what decides which
  // runner drives the file. A chat list filed against a background agent would
  // otherwise reach a runner that cannot read it, and fail there with no
  // mention of this file.
  if (envelope.data.agentId !== expected.agentId) {
    throw new CaseListError(
      `${source}: declares agentId "${envelope.data.agentId}" but the ` +
        `registry points ${expected.agentId} at it`,
    )
  }
  if (envelope.data.shape !== expected.shape) {
    throw new CaseListError(
      `${source}: declares shape "${envelope.data.shape}" but ` +
        `${expected.agentId} is a ${expected.shape} agent`,
    )
  }

  const schema = CASE_SCHEMAS[envelope.data.shape]
  const cases: JudgeCase[] = []
  const seen = new Set<string>()

  envelope.data.cases.forEach((raw, index) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      // The index is always available; the id only when it is a string, which
      // is exactly the case where naming it helps.
      const id =
        typeof raw.caseId === 'string' ? ` (caseId "${raw.caseId}")` : ''
      throw new CaseListError(
        `${source}: case ${index}${id} is not a valid ` +
          `${envelope.data.shape} case — ` +
          describeIssues(parsed.error.issues),
      )
    }
    // Two cases under one id would collide on the record store key and the
    // second would silently overwrite the first, which reads downstream as a
    // sweep that ran fewer cases than it was billed for.
    if (seen.has(parsed.data.caseId)) {
      throw new CaseListError(
        `${source}: case ${index} repeats caseId ` +
          `"${parsed.data.caseId}"; ids must be unique within a list ` +
          'because each one names a stored record',
      )
    }
    seen.add(parsed.data.caseId)
    cases.push(parsed.data)
  })

  return {
    agentId: envelope.data.agentId,
    shape: envelope.data.shape,
    placeholder: envelope.data.placeholder ?? false,
    ...(envelope.data.note !== undefined && { note: envelope.data.note }),
    cases,
    source,
  }
}

export const CASES_DIR = path.join(__dirname, 'cases')

// Resolved under CASES_DIR and required to stay there: `cases` is a registry
// string, and a registry string that could address `../../../etc` would make
// the case list a file-read primitive.
export const caseListPath = (
  cases: string,
  dir: string = CASES_DIR,
): string => {
  const resolved = path.resolve(dir, cases)
  const root = path.resolve(dir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new CaseListError(
      `case list "${cases}" resolves outside ${root}; a registry entry ` +
        'names a file in the case-list directory, not a path',
    )
  }
  return resolved
}

export const loadCaseList = (
  agent: AgentEntry,
  dir: string = CASES_DIR,
): CaseList => {
  if (agent.cases === null) {
    throw new CaseListError(
      `${agent.agentId} has no case list yet, so it has no inputs and ` +
        'there is nothing to compare',
    )
  }
  const file = caseListPath(agent.cases, dir)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    throw new CaseListError(
      `${file}: cannot be read — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return parseCaseList(file, text, {
    agentId: agent.agentId,
    shape: agent.shape,
  })
}
