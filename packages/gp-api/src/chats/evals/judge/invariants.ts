import { TranscriptInputSchema } from './cases'
import { renderPayload } from './normalize'
import type { Payload, RunRecord } from './record'

// RULES AN AGENT'S OUTPUT MUST SATISFY, checked per arm and reported beside
// the verdict rather than folded into it.
//
// WHY A COMPARISON CANNOT DO THIS JOB. The judge compares two outputs and says
// which reads better. Delete a rule from an agent's system prompt and the
// outputs that follow often read BETTER — a vocabulary constraint costs
// directness — so a pairwise judge reports the regression as an improvement,
// and feeding it the prompt would not change that. "Worse" here is a
// conformance fact about one output, not a quality fact about a pair, so it
// needs an assertion and not an opinion.
//
// Deterministic and free: no model call, no extra record field, nothing
// published that was not already in the record. The shape follows
// `unpinnedMartReads` — a fact computed over every record, printed next to the
// verdict, never part of it.
export interface Invariant {
  name: string
  // Printed in the report, so it has to say what the rule is to someone who
  // has not read the prompt it came from.
  describe: string
  // True when this output breaks the rule. `input` is the user's own turn, so
  // a rule can exempt the case where the user raised the subject first.
  violated: (output: string, input: string) => boolean
}

// `voter`, `voters`. Deliberately not `voting`/`turnout`/`election`: the rule
// is about what the people are CALLED, and an answer about an election is
// allowed to mention one.
const SAYS_VOTERS = /\bvoters?\b/i

// THE ACTIVITY, NOT THE PEOPLE, and the distinction is the rule's own. Its
// exception is "the user themselves raises voting, turnout, or an election
// result" — three things, every one of them an event or a metric. "Registered
// voters" is none of them: it is a population described by its registration
// status, and the rule pre-empts exactly that case one clause earlier with
// "this applies even when the underlying data is a voter file: report it as
// constituent data".
//
// So `voter` and `voters` are deliberately ABSENT here. Including them let the
// exemption swallow the one case the rule names out loud — and it made the
// case list's `constituent-count` probe look exempt from the rule it was
// written to probe, which it is not.
const USER_RAISED_VOTING =
  /\b(voting|vote|votes|voted|turnout|election|elections|ballot|ballots|precinct)\b/i

export const AGENT_INVARIANTS: Readonly<Record<string, readonly Invariant[]>> =
  {
    // docs/product-vocabulary.md, and the Chief of Staff prompt's own line:
    // elected officials have constituents, not voters. The prompt says this
    // "applies even when the underlying data is a voter file: report it as
    // constituent data", so naming the file is a violation too — that is the
    // rule as written, not a strict reading of it.
    chief_of_staff: [
      {
        name: 'constituents-not-voters',
        describe:
          'The user holds office and governs everyone in the district, so the ' +
          'people they serve are constituents, residents or people in the ' +
          'district — never voters, even when the underlying data is a voter ' +
          'file. The one exception is an answer where the user raised voting, ' +
          'turnout or an election themselves, which the agent may match.',
        violated: (output, input) =>
          SAYS_VOTERS.test(output) && !USER_RAISED_VOTING.test(input),
      },
    ],
  }

export interface InvariantViolation {
  agentId: string
  invariant: string
  describe: string
  // Runs, per arm. Both arms and every attempt count, because each run is a
  // separate chance for the agent to break the rule — and the number that
  // matters is whether the CANDIDATE broke it where the base did not.
  baseRuns: number
  candidateRuns: number
  // Distinct cases the candidate broke it on, so a reader can go and look.
  candidateCaseIds: readonly string[]
  // Runs of each arm that produced NO answer, so no rule could be checked on
  // them. Carried because `baseRuns: 0` has two very different causes — the
  // base kept the rule, or the base never answered — and the headline claims
  // the first.
  baseUnknownRuns: number
  candidateUnknownRuns: number
}

const textOf = (record: RunRecord): string | null =>
  record.output === null ? null : renderPayload(record.output)

// WHAT THE USER ACTUALLY SAID, which is narrower than the rendered input. A
// multi-turn case renders `seededTranscript` too — a prior conversation the
// HARNESS wrote, including assistant turns — so checking the exemption against
// the whole rendering lets a seeded turn that mentions an election excuse the
// agent on a case where the user never raised it.
//
// `turns` is the user's own turns and nothing else. An unrecognised payload
// kind falls back to the full rendering, which errs toward exempting: a new
// shape that gains invariants needs an extractor here, and the comment is the
// reminder.
const userTextOf = (payload: Payload): string => {
  if (payload.kind === 'transcript') {
    const parsed = TranscriptInputSchema.safeParse(payload.value)
    if (parsed.success) return parsed.data.turns.join('\n')
  }
  return renderPayload(payload)
}

export const invariantViolations = (
  records: readonly RunRecord[],
  invariants: Readonly<Record<string, readonly Invariant[]>> = AGENT_INVARIANTS,
): InvariantViolation[] => {
  const byKey = new Map<
    string,
    {
      agentId: string
      invariant: Invariant
      baseRuns: number
      candidateRuns: number
      candidateCaseIds: Set<string>
    }
  >()
  // Counted before the rules, because a run with no answer contributes to no
  // violation and still has to be reported: it is the difference between "the
  // base kept this rule" and "nobody knows what the base did".
  const unknown = new Map<string, { base: number; candidate: number }>()
  for (const record of records) {
    if (invariants[record.agentId] === undefined) continue
    if (textOf(record) !== null) continue
    const seen = unknown.get(record.agentId) ?? { base: 0, candidate: 0 }
    if (record.arm === 'candidate') seen.candidate += 1
    else seen.base += 1
    unknown.set(record.agentId, seen)
  }

  for (const record of records) {
    const rules = invariants[record.agentId]
    if (rules === undefined) continue
    const output = textOf(record)
    // Null output is an infraError — there is no answer to hold to a rule,
    // and counting it as compliant would be as wrong as counting it as a
    // violation. Counted into `unknown` above instead.
    if (output === null) continue
    const input = userTextOf(record.input)
    for (const invariant of rules) {
      if (!invariant.violated(output, input)) continue
      const key = `${record.agentId}\u0000${invariant.name}`
      const entry = byKey.get(key) ?? {
        agentId: record.agentId,
        invariant,
        baseRuns: 0,
        candidateRuns: 0,
        candidateCaseIds: new Set<string>(),
      }
      if (record.arm === 'candidate') {
        entry.candidateRuns += 1
        entry.candidateCaseIds.add(record.caseId)
      } else {
        entry.baseRuns += 1
      }
      byKey.set(key, entry)
    }
  }
  return [...byKey.values()].map((entry) => {
    const seen = unknown.get(entry.agentId) ?? { base: 0, candidate: 0 }
    return {
      agentId: entry.agentId,
      invariant: entry.invariant.name,
      describe: entry.invariant.describe,
      baseRuns: entry.baseRuns,
      candidateRuns: entry.candidateRuns,
      candidateCaseIds: [...entry.candidateCaseIds].sort(),
      baseUnknownRuns: seen.base,
      candidateUnknownRuns: seen.candidate,
    }
  })
}
