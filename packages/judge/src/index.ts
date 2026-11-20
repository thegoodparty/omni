// What a suite file needs: the definition helper and the context it runs
// against. A suite may import nothing else from this package, and may only
// `import type` from gp-api — the runner holds no gp-api runtime code.
export {
  defineExpectedResultEvalSuite,
  type Annotate,
  type ExpectedResultEvalCase,
  type ExpectedResultEvalSuite,
  type ExpectedResultJudgeContext,
  type ExpectedResultRunContext,
} from './expectedResult'
export { type JudgeModel } from './judgeModel'
export {
  isPairwiseAgentEvalSuite,
  type AgentRunResult,
  type AgentRunStatus,
  type CaseGrading,
  type EvalApi,
  type EvalCase,
  type EvalContext,
  type EvalMode,
  type PairwiseAgentEvalSuite,
  type PairwiseAgentEvalSuiteDefinition,
  type SuiteProfile,
} from './suite'
export { definePairwiseAgentEvalSuite } from './pairwise'
export {
  briefingChatTurns,
  chatTurns,
  type BriefingChatAnchor,
  type BriefingChatTurnsInput,
  type ChatScope,
  type ChatTurnsInput,
} from './chatTurns'
