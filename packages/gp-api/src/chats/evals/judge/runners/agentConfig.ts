import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { JsonValueSchema } from '../record'
import type { AgentConfig } from './background'

// THE BEHAVIOR PROJECTION, built from the published manifest rather than
// substituted for it.
//
// A judge override may change what an agent is TOLD to do and never what it is
// ALLOWED to touch. The consumer enforces that — `validateOverrideManifest`
// refuses any field outside the behavior set, and the dispatch Lambda refuses
// the whole override for a write-action experiment — but neither of those is a
// reason to hand them a document and hope. This builds the narrow thing on
// purpose, so `scope`, `routing`, `input_schema` and anything a future manifest
// gains are dropped here, at the one place that reads the published file.
//
// Kept beside the runner rather than in the arm suite because the rule belongs
// to the dispatch contract, not to whoever happens to be capturing.
// A zod object STRIPS unknown keys, so the schema is the projection rather
// than a list something else has to apply. Every behavior field is optional
// here and the required ones are checked below, because "absent" and "the
// wrong type" deserve different sentences — a manifest with `max_turns: "20"`
// is a different problem from one with no max_turns at all.
const BehaviorProjectionSchema = z.object({
  model: z.string().optional(),
  max_turns: z.number().optional(),
  timeout_seconds: z.number().optional(),
  output_schema: JsonValueSchema.optional(),
  // An OBJECT, not a string — {max_parallel_subagents, max_thinking_tokens}
  // in every published manifest. Typed as JSON rather than that exact shape
  // because the consumer validates it and this file only has to carry it
  // across intact; narrowing it here would reject a runtime field that gains
  // a key the runner already understands.
  runtime: JsonValueSchema.optional(),
})

// What the Fargate runner requires of any manifest the broker serves it. A
// published experiment that is missing one of these cannot be swept, and
// saying so here names the experiment instead of failing later with the
// consumer's own wording and no agent id.
// timeout_seconds is here because the sweep derives its artifact poll from
// it: without one there is no budget to wait out, and the alternative is a
// flat constant that was shorter than eleven of the sixteen agents' own
// declared timeouts — a healthy run abandoned inside its budget, billed, and
// then excluded from the delta as an infraError.
const REQUIRED_FIELDS = [
  'model',
  'max_turns',
  'output_schema',
  'timeout_seconds',
] as const

export class AgentConfigError extends Error {}

// Where `publish_experiments.py` reads from, and therefore the only statement
// of what an experiment actually is. Resolved from this file so a worktree or
// a different checkout root still finds it.
const EXPERIMENTS_DIR = path.resolve(
  __dirname,
  '../../../../../../..',
  'packages/runbooks/experiments',
)

const readExperimentFile = (agentId: string, leaf: string): string => {
  const file = path.join(EXPERIMENTS_DIR, agentId, leaf)
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    throw new AgentConfigError(
      `cannot read ${leaf} for ${agentId} at ${file}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export const agentConfigFor = (
  agentId: string,
  readFile: (agentId: string, leaf: string) => string = readExperimentFile,
): AgentConfig => {
  const raw = readFile(agentId, 'manifest.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new AgentConfigError(
      `${agentId}'s manifest.json is not JSON: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = BehaviorProjectionSchema.safeParse(parsed)
  if (!result.success) {
    throw new AgentConfigError(
      `${agentId}'s published manifest does not carry the behavior fields ` +
        `in the shape the runner needs: ${result.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
    )
  }
  const projected = result.data

  const absent = REQUIRED_FIELDS.filter(
    (field) => projected[field] === undefined,
  )
  if (absent.length > 0) {
    throw new AgentConfigError(
      `${agentId}'s published manifest has no ${absent.join(', ')}, which ` +
        'the Fargate runner requires of any manifest the broker serves it, ' +
        'so this experiment cannot be swept until its manifest carries them',
    )
  }

  return {
    manifest: JSON.stringify(projected),
    instruction: readFile(agentId, 'instruction.md'),
  }
}
