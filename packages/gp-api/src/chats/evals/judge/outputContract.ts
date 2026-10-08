import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NormalizedAgent } from './normalize'

// What a background agent's artifact is required to contain, shown to the
// judge so it can tell a required section from an unrequested addition. The
// first bench read scored a required section as an addition because nothing
// in the shared input said it was required.
//
// Top-level `required` names only, with a one-level type where the schema
// gives one. A schema that requires nothing at the top level (a `oneOf`
// artifact) has no contract to show, and that is reported rather than guessed.

export interface ContractField {
  name: string
  type?: string
}

export type OutputContract = readonly ContractField[]

// Why no contract line went to the judge for an agent. Fixed values, because
// the report is public and prints them.
export type ContractNote = 'noRequired' | 'unread'

const TypeSchema = z.union([z.string(), z.array(z.string())])

const ManifestSchema = z.object({
  output_schema: z
    .object({
      required: z.array(z.string()).optional(),
      properties: z
        .record(z.string(), z.object({ type: TypeSchema.optional() }).loose())
        .optional(),
    })
    .loose(),
})

// Null when the manifest names no required top-level field. Throws when the
// text is not a manifest at all, so the caller can tell "no contract" from
// "could not read one".
export const contractOf = (manifestText: string): OutputContract | null => {
  const schema = ManifestSchema.parse(JSON.parse(manifestText)).output_schema
  const required = schema.required ?? []
  if (required.length === 0) return null
  return required.map((name) => {
    const type = schema.properties?.[name]?.type
    if (type === undefined) return { name }
    return { name, type: Array.isArray(type) ? type.join(' or ') : type }
  })
}

const fieldList = (contract: OutputContract): string =>
  contract
    .map((field) =>
      field.type === undefined ? field.name : `${field.name} (${field.type})`,
    )
    .join(', ')

const namesOf = (contract: OutputContract | null): string =>
  [...(contract ?? []).map((field) => field.name)].sort().join('\0')

// The line the judge reads, plus a second when the base ref required a
// different set: a PR that changes the contract makes a new field look like
// an addition from the base's side, and the judge has to know which side the
// contract belongs to. `base` undefined means the base manifest was not read,
// which says nothing about a change, so no second line.
export const contractLines = (
  candidate: OutputContract,
  base: OutputContract | null | undefined,
): string => {
  const lines = [
    `Output contract: the artifact must include these top-level fields: ` +
      `${fieldList(candidate)}.`,
  ]
  if (base !== undefined && namesOf(base) !== namesOf(candidate)) {
    lines.push(
      'The output contract changed in this PR. Before it, the required ' +
        `fields were: ${base === null ? 'none' : fieldList(base)}.`,
    )
  }
  return lines.join('\n')
}

// Added to the shared input AFTER blinding, and BEFORE `withConditions`, so a
// case's condition stays the last line, which is where the rubric tells the
// judge to find it.
export const withOutputContract = (
  normalized: NormalizedAgent,
  lines: string | null,
): NormalizedAgent =>
  lines === null
    ? normalized
    : {
        ...normalized,
        judgeable: normalized.judgeable.map((one) => ({
          ...one,
          payload: {
            ...one.payload,
            sharedInput: `${one.payload.sharedInput}\n\n${lines}`,
          },
        })),
      }

export interface ContractRead {
  candidate: OutputContract | null | 'unread'
  // Undefined when there is no base checkout to read, or it could not be read.
  base?: OutputContract | null
}

const EXPERIMENTS = 'packages/runbooks/experiments'

// This checkout, located from this file so a worktree finds its own.
const CANDIDATE_ROOT = path.resolve(__dirname, '../../../../../..')

const readContract = (root: string, agentId: string): OutputContract | null =>
  contractOf(
    readFileSync(
      path.join(root, EXPERIMENTS, agentId, 'manifest.json'),
      'utf8',
    ),
  )

export const readOutputContracts = (
  agentId: string,
  baseDir: string | undefined,
): ContractRead => {
  let candidate: OutputContract | null | 'unread'
  try {
    candidate = readContract(CANDIDATE_ROOT, agentId)
  } catch {
    candidate = 'unread'
  }
  if (baseDir === undefined) return { candidate }
  try {
    return { candidate, base: readContract(baseDir, agentId) }
  } catch {
    return { candidate }
  }
}

// The judge-facing text and the report note for one agent, from what was read.
export const contractFor = (
  read: ContractRead,
): { lines: string | null; note?: ContractNote } => {
  if (read.candidate === 'unread') return { lines: null, note: 'unread' }
  if (read.candidate === null) return { lines: null, note: 'noRequired' }
  return { lines: contractLines(read.candidate, read.base) }
}
