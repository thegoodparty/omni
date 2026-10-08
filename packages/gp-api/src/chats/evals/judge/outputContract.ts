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
export type ContractNote = 'noRequired' | 'unread' | 'baseUnread'

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

const rendered = (contract: OutputContract | null): string =>
  contract === null || contract.length === 0 ? 'none' : fieldList(contract)

// ARM-NEUTRAL BY CONSTRUCTION. The judge must not learn which run is the
// candidate, so when the two refs' manifests require different sets, nothing
// here says which set is the new one: the "must include" line lists only the
// fields both require, and the two sets follow in an order fixed by their own
// text. Swapping the arguments renders the same bytes. A field in only one set
// is named as neither an addition nor an omission, because a run produced
// under a contract that never asked for it can't be faulted for leaving it out.
// `other` undefined means the base manifest was not read, which says nothing
// about a change, so the candidate's contract is shown as the contract.
export const contractLines = (
  one: OutputContract | null,
  other: OutputContract | null | undefined,
): string | null => {
  if (other === undefined || namesOf(one) === namesOf(other)) {
    return one === null || one.length === 0
      ? null
      : 'Output contract: the artifact must include these top-level ' +
          `fields: ${fieldList(one)}.`
  }
  const otherNames = new Set((other ?? []).map((field) => field.name))
  const shared = (one ?? [])
    .filter((field) => otherNames.has(field.name))
    .map((field) => {
      const twin = (other ?? []).find((f) => f.name === field.name)
      return twin?.type === field.type ? field : { name: field.name }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const [first, second] = [rendered(one), rendered(other)].sort()
  return [
    ...(shared.length === 0
      ? []
      : [
          'Output contract: the artifact must include these top-level ' +
            `fields: ${fieldList(shared)}.`,
        ]),
    'The two runs may have been produced under different output ' +
      `contracts. One required: ${first}; the other required: ${second}. ` +
      'A field in only one of these sets is neither an addition nor an ' +
      'omission.',
  ].join('\n')
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
  // Undefined when there is no base checkout to read.
  base?: OutputContract | null | 'unread'
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
    return { candidate, base: 'unread' }
  }
}

// The judge-facing text and the report note for one agent, from what was read.
// An unread base still shows the candidate's contract, and says the comparison
// was not made rather than dropping it silently.
export const contractFor = (
  read: ContractRead,
): { lines: string | null; note?: ContractNote } => {
  if (read.candidate === 'unread') return { lines: null, note: 'unread' }
  if (read.base === 'unread') {
    return {
      lines: contractLines(read.candidate, undefined),
      note: read.candidate === null ? 'noRequired' : 'baseUnread',
    }
  }
  const lines = contractLines(read.candidate, read.base)
  return lines === null ? { lines, note: 'noRequired' } : { lines }
}
