import type { TestModeElectionPreset } from '@goodparty_org/contracts'
import type { TestRace } from '@goodparty_org/test-users'

// A suite declares which kind of test user its cases need, and one profile for
// all of them: a case's three attempts are three identities with that same
// profile, so only the account differs between attempts.
export type EvalMode = 'win' | 'serve'

export type SuiteProfile = {
  // The name the test identity is given, so a case's attempts read as one
  // person under three accounts.
  firstName?: string
  lastName?: string
  // win: the real office the campaign runs for. The district the agent sees is
  // derived from the race gp-api resolves for this office; it is not a separate
  // setting.
  race?: TestRace
  // win: the campaign's election state, computed by gp-api from its own clock.
  election?: TestModeElectionPreset
  // serve: the office the elected office is bound to, and its term. A position
  // id is what gives the org a district; an unbound office resolves no district
  // and every district-scoped agent read comes back unavailable.
  positionId?: string
  positionName?: string
  termStartDate?: string
  termEndDate?: string
}

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'superseded'

// One background agent run, read through the base URL alone.
export type AgentRunResult = {
  runId: string
  engine?: string
  status: AgentRunStatus
  // The validated artifact, as the route returns it. Absent until the run has
  // completed.
  artifact: unknown
  // The run's failure text, when it failed. Null otherwise.
  error: string | null
}

// Signed in as this run's test user, and scoped to its org. Paths are relative
// to the API root (`<baseUrl>/api`), the same base the e2e suite's clients use.
export type EvalApi = {
  get: <T = unknown>(
    path: string,
    config?: { params?: Record<string, unknown> },
  ) => Promise<T>
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>
  put: <T = unknown>(path: string, body?: unknown) => Promise<T>
}

export type EvalContext = {
  api: EvalApi
  // The arm's webapp root: dev for the base arm, a PR preview for the candidate.
  baseUrl: string
  // The org the bootstrap created for this run's test user, so nothing has to
  // create one.
  org: { slug: string }
  // The only background helper. The route picks the engine, so a suite never
  // knows whether it is driving gp-api's agent or the PMF Engine.
  runAgent: (name: string, input: unknown) => Promise<AgentRunResult>
}

export type CaseGrading = {
  // What is special about this case.
  condition?: string
  // A pass/fail rule the judge checks on each run, as a sentence.
  handledWhen?: string
  // Extra questions, name to question, each scored 1 to 5 on both sides. They
  // come on top of the suite's default dimensions.
  dimensions?: Record<string, string>
}

export type EvalCase<Input> = {
  id: string
  input: Input
  // State the case needs before the agent runs. Through public routes, or by
  // running another agent: never by writing rows.
  setup?: (ctx: EvalContext) => Promise<void>
  grading?: CaseGrading
}

export type PairwiseAgentEvalSuite<Input> = {
  readonly isPairwiseAgentEvalSuite: true
  name: string
  mode: EvalMode
  profile: SuiteProfile
  // Method syntax on purpose. A suite's `run` takes its own input type, and the
  // runner holds discovered suites with that type erased: method parameters are
  // compared bivariantly, so a typed suite is assignable to the erased view
  // instead of needing a cast at the boundary. `cases` is covariant already.
  run(input: Input, ctx: EvalContext): Promise<string>
  cases: EvalCase<Input>[]
}

// A suite as the runner sees it, after discovery: the input type is erased
// because nothing outside the suite knows it, and the only caller of `run` is
// the runner, handing back the same case's own input.
export type AnyPairwiseAgentEvalSuite = PairwiseAgentEvalSuite<unknown>

export type PairwiseAgentEvalSuiteDefinition<Input> = {
  mode: EvalMode
  profile: SuiteProfile
  run: (input: Input, ctx: EvalContext) => Promise<string>
  cases: EvalCase<Input>[]
}

export const createPairwiseAgentEvalSuite = <Input>(
  name: string,
  definition: PairwiseAgentEvalSuiteDefinition<Input>,
): PairwiseAgentEvalSuite<Input> => {
  if (!name) throw new Error('A suite needs a name')
  if (definition.cases.length === 0) {
    throw new Error(`Suite '${name}' has no cases`)
  }
  const ids = new Set<string>()
  for (const theCase of definition.cases) {
    if (!theCase.id) throw new Error(`Suite '${name}' has a case with no id`)
    if (ids.has(theCase.id)) {
      throw new Error(`Suite '${name}' has two cases with id '${theCase.id}'`)
    }
    ids.add(theCase.id)
  }
  return { ...definition, name, isPairwiseAgentEvalSuite: true }
}

export const isPairwiseAgentEvalSuite = (
  value: unknown,
): value is PairwiseAgentEvalSuite<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (value as { isPairwiseAgentEvalSuite?: unknown }).isPairwiseAgentEvalSuite ===
    true
