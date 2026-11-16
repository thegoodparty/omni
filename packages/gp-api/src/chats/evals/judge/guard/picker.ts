import { z } from 'zod'

// Section 2.5 of the Implementation Notes: "about 200 characters," so this is
// a named constant rather than a literal repeated at the schema and at the
// sanitizer.
export const MAX_REASON_CHARS = 200

// The picker is a cents-scale call (TDD: "The picker on top of paths catches
// shared changes for cents"), so it reuses the judge panel's own seat rather
// than adding a second model knob nothing else needs.
export const PICKER_MODEL = 'claude-sonnet-4-6'

// N KB for the diff the picker reads (TDD "When the picker fails"; test plan
// "Diff truncation"). Chosen conservatively: the picker only needs enough of
// the diff to see which shared surfaces moved, not every line, and a bigger
// cap means a bigger, costlier prompt on every guard run.
export const MAX_DIFF_BYTES = 64 * 1024

export const DIFF_TRUNCATED_MARKER =
  '\n\n--- diff truncated: over the guard picker size cap ---\n'

// Raw shape the model must answer in. `reason` just needs to be present —
// sanitizeAddition (below) does the length cap and link stripping, so a
// reason that is merely long or linky is sanitized rather than failing the
// whole response's shape.
const RawAdditionSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1),
})

export const PickerOutputSchema = z.object({
  add: z.array(RawAdditionSchema),
  notes: z.string().optional(),
})
export type PickerOutput = z.infer<typeof PickerOutputSchema>

export interface Addition {
  readonly agentId: string
  readonly reason: string
}

export interface ValidatedPicks {
  readonly add: readonly Addition[]
  // Ids the model tried to add that are not in the registry — named on the
  // check per the failure table ("An added id isn't in the registry ...
  // Names the dropped id").
  readonly droppedIds: readonly string[]
}

// Links are stripped from a reason before it is posted on the check, because
// the reason is produced by a model reading a diff the PR author wrote
// (Implementation Notes 2.5's prompt-injection note): a link is the one part
// of a "short reason" that could carry a lure rather than an explanation.
const URL_PATTERN = /\bhttps?:\/\/\S+/gi

export const sanitizeReason = (reason: string): string => {
  const withoutLinks = reason.replace(URL_PATTERN, '[link removed]').trim()
  return withoutLinks.length > MAX_REASON_CHARS
    ? `${withoutLinks.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…`
    : withoutLinks
}

// The final agent set is always the floor plus validated additions — the
// floor is never shrunk by anything the picker says (TDD: "It can't remove
// any, because the PR author writes the diff"; AC: "the picker never removes
// a floor-matched agent").
export const validatePickerOutput = (
  output: PickerOutput,
  registryIds: ReadonlySet<string>,
): ValidatedPicks => {
  const add: Addition[] = []
  const droppedIds: string[] = []
  for (const candidate of output.add) {
    if (!registryIds.has(candidate.agentId)) {
      droppedIds.push(candidate.agentId)
      continue
    }
    add.push({
      agentId: candidate.agentId,
      reason: sanitizeReason(candidate.reason),
    })
  }
  return { add, droppedIds }
}

export const finalAgentSet = (
  floor: readonly string[],
  add: readonly Addition[],
): readonly string[] => {
  const seen = new Set(floor)
  const merged = [...floor]
  for (const { agentId } of add) {
    if (seen.has(agentId)) continue
    seen.add(agentId)
    merged.push(agentId)
  }
  return merged
}

export interface TruncatedDiff {
  readonly diff: string
  readonly truncated: boolean
}

// Truncated with a marker, never rejected (test plan: "a diff over the size
// cap is truncated with a marker, and the picker is instructed to rely on
// paths"). Byte length, not character length, because the cap is about
// prompt/payload size.
export const truncateDiff = (
  diff: string,
  maxBytes: number = MAX_DIFF_BYTES,
): TruncatedDiff => {
  if (Buffer.byteLength(diff, 'utf8') <= maxBytes) {
    return { diff, truncated: false }
  }
  const markerBytes = Buffer.byteLength(DIFF_TRUNCATED_MARKER, 'utf8')
  const budget = Math.max(maxBytes - markerBytes, 0)
  const kept = Buffer.from(diff, 'utf8').subarray(0, budget).toString('utf8')
  return { diff: `${kept}${DIFF_TRUNCATED_MARKER}`, truncated: true }
}

export interface PickerPromptInput {
  readonly changedPaths: readonly string[]
  readonly diff: string
  readonly diffTruncated: boolean
  readonly floor: readonly string[]
  readonly codeMap: readonly { path: string; agentIds: readonly string[] }[]
  readonly agentDirectories: readonly { path: string; agentId: string }[]
  readonly registryIds: readonly string[]
}

// The system instruction is the TDD's own wording verbatim (Implementation
// Notes 5, "Picker"): "Add an agent only if this change can alter what that
// agent does. When unsure, add it." Everything else is the structured
// context the model needs to apply that rule.
// The response is parsed as plain JSON (picker.test.ts /
// parsePickerOutput), not grammar-enforced by the model API, so the shape is
// spelled out here rather than left to a schema the call never sends. A
// malformed reply is a real, reachable outcome (the "isn't JSON or fails the
// shape" row of the failure table) precisely because nothing on the wire
// forces it — see runPickerCli.ts's header for why jsonCompletion's
// schema-validated path is not used here.
export const PICKER_SYSTEM_PROMPT =
  'You review a pull request diff for a GitHub Actions guard that judges ' +
  'AI agents. You are given the diff, a map from code paths to the agents ' +
  'they can affect, and the set of agents already selected by exact-path ' +
  'matching (the floor). Decide which OTHER agents from the registry this ' +
  "diff's changes could also affect, because it touches code they share. " +
  'Add an agent only if this change can alter what that agent does. When ' +
  'unsure, add it. You cannot remove an agent from the floor, and you have ' +
  'no tools — judge only from the diff and the map you are given.\n\n' +
  'Respond with ONLY a single JSON object, no markdown fences and no other ' +
  'text, matching exactly this shape:\n' +
  '{"add": [{"agentId": "<id from the registry>", "reason": "<short reason, ' +
  'under 200 characters, no links>"}], "notes": "<optional short note>"}\n' +
  'If no agent should be added, respond with {"add": []}.'

export const buildPickerUserPrompt = (input: PickerPromptInput): string => {
  const lines = [
    `Registry agent ids: ${input.registryIds.join(', ')}`,
    `Path-matched floor (already selected, cannot be removed): ${
      input.floor.length > 0 ? input.floor.join(', ') : '(none)'
    }`,
    '',
    'Changed paths:',
    ...input.changedPaths.map((p) => `- ${p}`),
    '',
    'Agent directories (path -> the one agent that owns it; the floor ' +
      'already matched changed files here):',
    ...input.agentDirectories.map((dir) => `- ${dir.path} -> ${dir.agentId}`),
    '- packages/runbooks/experiments/<agentId>/ -> <agentId> (not _schema/)',
    'A changed file under an agent directory reaches only that agent, ' +
      'unless a code map row below covers that file. Do not add an agent ' +
      'because the file, a comment, or the diff mentions it by name.',
    '',
    'Code map (path -> agents a change there can reach):',
    ...input.codeMap.map(
      (row) => `- ${row.path} -> ${row.agentIds.join(', ')}`,
    ),
    '',
  ]
  if (input.diffTruncated) {
    lines.push(
      'NOTE: the diff below was truncated to fit the size cap. Reason ' +
        'about the changed paths and the code map above rather than ' +
        'relying on diff content you cannot see.',
      '',
    )
  }
  lines.push('Diff:', input.diff)
  return lines.join('\n')
}
