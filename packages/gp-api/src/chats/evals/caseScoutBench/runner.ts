import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compareAsc } from 'date-fns'
import { z } from 'zod'
import {
  CANDIDATE_MIN_SEVERITY,
  COVERED_SCOPES,
} from '@/caseScout/caseScout.config'
import {
  SCORING_PROMPT,
  SECOND_READ_PROMPT,
} from '@/caseScout/caseScout.prompts'
import {
  DraftOutcome,
  type DraftOutcome as DraftOutcomeValue,
} from '@/caseScout/schemas/caseScoutBucket.schema'
import {
  MAX_FAILURE_SUMMARY_LENGTH,
  MAX_REASON_LENGTH,
  MAX_SUMMARY_LENGTH,
  type DraftResponse,
  type ScoreResponse,
} from '@/caseScout/schemas/caseScoutModel.schema'
import type { DraftedCase } from '@/caseScout/schemas/draftedCase.schema'
import {
  emptyCaseList,
  LIST_SOFT_CAP,
  type CaseListInfo,
} from '@/caseScout/services/caseScoutCaseLists.service'
import {
  ScoreParseError,
  type CaseScoutModelService,
} from '@/caseScout/services/caseScoutModel.service'
import { findDateDrift } from '@/caseScout/util/dateDrift.util'
import {
  buildDraftedCase,
  buildDraftingPrompt,
  draftCandidate,
  DraftingError,
  type Drafter,
} from '@/caseScout/util/drafting.util'
import {
  gateDraft,
  gateNeedsSetup,
  validateAgainstSchema,
  WITHHELD_NEEDS_SETUP,
  type GateResult,
  type GateRule,
  type SecondReadCall,
} from '@/caseScout/util/gate.util'
import {
  findDuplicate,
  findRejection,
  recentProposalsForAgent,
  type LedgerEntry,
} from '@/caseScout/util/ledger.util'
import {
  segmentIntoSessions,
  type Session,
} from '@/caseScout/util/sessions.util'
import {
  renderSessionTranscript,
  sessionDenylist,
  sessionSourceTexts,
} from '@/caseScout/util/transcript.util'
import { CASES_DIR, CaseListError, parseCaseList } from '../judge/cases'
import {
  conversationIdOf,
  fixtureMessages,
  type BenchFixture,
  type Expectation,
} from './fixtures'

// The three calls CaseScoutModelService makes. A live run passes the service
// itself; a stub run and the tests pass stand-ins.
export type BenchModel = Pick<
  CaseScoutModelService,
  'scoreTranscript' | 'draftCase' | 'secondRead'
>

export type Stage = 'score' | 'draft' | 'gate'

export type RecordedCall = {
  stage: Stage
  sessionId: string
  inputChars: number
  outputChars: number
}

export const PASS = 'pass'
export const FAIL = 'fail'
export const NOT_APPLICABLE = 'n/a'
export type CheckStatus = typeof PASS | typeof FAIL | typeof NOT_APPLICABLE
export type Check = { status: CheckStatus; detail: string }

export type RequestScore = {
  severity: number
  knownPattern: string
  majorFailureType: string
  overallRating: string
  summary: string
  reason: string
}

export type BenchScore = { severity: number; requests: RequestScore[] }

export type DraftResponseSummary = {
  outcome: DraftResponse['outcome']
  failureSummary: string
  case: DraftResponseCase | null
  coveredBy: string | null
  needsSetup: string | null
}

type DraftResponseCase = {
  caseId: string
  question?: string
  turns?: string[]
  condition: string
  handledWhen: string
}

export type GateSummary = {
  passed: boolean
  rule: GateRule | null
  reason: string | null
}

export type Grades = {
  faithful: 1 | 2 | 3 | null
  gradeable: 1 | 2 | 3 | null
  fictional: 1 | 2 | 3 | null
  note: string
}

export type FixtureResult = {
  id: string
  agent: string
  category: BenchFixture['category']
  summary: string
  notes: string
  expect: Expectation
  sessionIds: string[]
  score: BenchScore | null
  scoringError: string | null
  outcome: DraftOutcomeValue | null
  coveredBy: string | null
  needsSetup: string | null
  draftResponse: DraftResponseSummary | null
  gate: GateSummary | null
  case: DraftedCase | null
  checks: Record<string, Check>
  passed: boolean
  grades: Grades
}

export type BenchRun = {
  runId: string
  calls: RecordedCall[]
  scoringErrors: string[]
  results: FixtureResult[]
}

// What the draft job decided for one candidate, kept per session so each
// fixture's result can be read back.
type Decision = {
  outcome: DraftOutcomeValue
  case: DraftedCase | null
  coveredBy: string | null
  needsSetup: string | null
  gate: GateSummary | null
  draftResponse: DraftResponseSummary | null
  failureSummary: string
}

const DRAFTED_OUTCOMES: ReadonlySet<DraftOutcomeValue> = new Set([
  DraftOutcome.proposed,
  DraftOutcome.listFull,
])

const SCORE_PARSE_ATTEMPTS = 2

// Reads the judge's case list from this checkout rather than GitHub main, so
// a run sees the conditions on the branch under test and makes no network
// call for them. Same fields CaseScoutCaseListsService.read takes.
export const readLocalCaseList = (
  agentId: string,
  casesDir: string = CASES_DIR,
): CaseListInfo => {
  let text: string
  try {
    text = readFileSync(path.join(casesDir, `${agentId}.json`), 'utf8')
  } catch {
    return emptyCaseList(agentId)
  }
  const list = parseCaseList(agentId, text, { agentId })
  return {
    agentId,
    caseCount: list.cases.length,
    caseIds: new Set(list.cases.map((c) => c.caseId)),
    conditions: list.cases.flatMap((c) => (c.condition ? [c.condition] : [])),
    fixtureDescription: list.note ?? '',
  }
}

const CaseListFileSchema = z
  .object({ cases: z.array(z.json()) })
  .catchall(z.json())

// Would the draft parse in the judge's own loader once appended to the
// agent's real list? Stricter than the gate's schema: unknown keys, nulls,
// trimmed lengths and repeated caseIds all fail here.
export const draftLoaderIssue = (
  agentId: string,
  draft: DraftedCase,
  casesDir: string = CASES_DIR,
): string | undefined => {
  let text: string
  try {
    text = readFileSync(path.join(casesDir, `${agentId}.json`), 'utf8')
  } catch (err) {
    return `could not read ${agentId}.json: ${String(err)}`
  }
  const payload = CaseListFileSchema.parse(JSON.parse(text))
  const appended = JSON.stringify({
    ...payload,
    cases: [...payload.cases, draft],
  })
  try {
    parseCaseList(`${agentId}.json`, appended, { agentId })
    return undefined
  } catch (err) {
    if (err instanceof CaseListError) return err.message
    throw err
  }
}

const check = (status: CheckStatus, detail = ''): Check => ({
  status,
  detail,
})

const stringsIn = (value: object | string | null | undefined): string[] => {
  if (typeof value === 'string') return [value]
  if (value === null || value === undefined) return []
  return Object.values(value).flatMap((v: object | string) => stringsIn(v))
}

export const plantedPiiFound = (
  value: object | string | null | undefined,
  planted: string[],
): string[] => {
  const text = stringsIn(value).join('\n').toLowerCase()
  return planted.filter((p) => text.includes(p.toLowerCase()))
}

const benchScore = (response: ScoreResponse): BenchScore => {
  const requests = response.requests.map((r) => ({
    severity: r.severity,
    knownPattern: r.known_pattern,
    majorFailureType: r.major_failure_type,
    overallRating: r.overall_rating,
    summary: r.summary_nonidentifying.slice(0, MAX_SUMMARY_LENGTH),
    reason: r.reason_nonidentifying.slice(0, MAX_REASON_LENGTH),
  }))
  return {
    severity: Math.max(...requests.map((r) => r.severity)),
    requests,
  }
}

const summarizeDraft = (result: DraftResponse): DraftResponseSummary => ({
  outcome: result.outcome,
  failureSummary: result.failureSummary,
  case: result.outcome === 'newCase' ? result.case : null,
  coveredBy: result.outcome === 'coveredBy' ? result.caseId : null,
  needsSetup: result.outcome === 'needsSetup' ? result.what : null,
})

// Runs the fixtures through gp-api's own scoring, drafting and PII-gate code
// the way caseScoutScore.service.ts and caseScoutDraft.service.ts call it,
// in one night. Two things differ on purpose: there is no spend cap or
// nightly draft cap, so every candidate is drafted, and the history is empty,
// so only tonight's own proposals count as duplicates.
export const runBench = async ({
  fixtures,
  model,
  now,
  runId,
  casesDir = CASES_DIR,
}: {
  fixtures: BenchFixture[]
  model: BenchModel
  now: Date
  runId: string
  casesDir?: string
}): Promise<BenchRun> => {
  const signal = new AbortController().signal
  const calls: RecordedCall[] = []
  const scoringErrors: string[] = []
  const scores = new Map<string, BenchScore>()
  const sessionErrors = new Map<string, string>()
  const decisions = new Map<string, Decision>()

  const sessions = segmentIntoSessions(fixtureMessages(fixtures))
  const candidates: Array<{ session: Session; severity: number }> = []

  for (const session of sessions) {
    if (!COVERED_SCOPES.has(session.scope)) continue
    const transcript = renderSessionTranscript(session)
    const inputChars = SCORING_PROMPT.length + transcript.length
    let lastParseError = 'unknown'
    let score: BenchScore | undefined
    let callFailed = false
    for (let attempt = 0; attempt < SCORE_PARSE_ATTEMPTS; attempt++) {
      try {
        const response = await model.scoreTranscript(transcript, signal)
        calls.push({
          stage: 'score',
          sessionId: session.sessionId,
          inputChars,
          outputChars: JSON.stringify(response).length,
        })
        if (response.requests.length > 0) {
          score = benchScore(response)
          break
        }
        lastParseError = 'scoring response had no requests'
      } catch (err) {
        calls.push({
          stage: 'score',
          sessionId: session.sessionId,
          inputChars,
          outputChars: 0,
        })
        if (!(err instanceof ScoreParseError)) {
          callFailed = true
          break
        }
        lastParseError = err.message
      }
    }
    if (score) {
      scores.set(session.sessionId, score)
      if (score.severity >= CANDIDATE_MIN_SEVERITY) {
        candidates.push({ session, severity: score.severity })
      }
      continue
    }
    const error = callFailed
      ? `session ${session.sessionId}: scoring call failed`
      : `session ${session.sessionId}: scoring response could not be ` +
        `parsed after retry (${lastParseError})`
    scoringErrors.push(error)
    sessionErrors.set(session.sessionId, error)
  }

  candidates.sort(
    (a, b) =>
      b.severity - a.severity ||
      compareAsc(a.session.startedAt, b.session.startedAt),
  )

  const caseLists = new Map<string, CaseListInfo>()
  const working: LedgerEntry[] = []
  const proposedIds = new Set<string>()

  // Records each drafting call by wrapping the model the shared drafter is
  // handed, so the bench drafts through exactly the job's code.
  const recordingDrafter = (session: Session): Drafter => ({
    draftCase: async (system, transcript, callSignal) => {
      let text = ''
      try {
        text = await model.draftCase(system, transcript, callSignal)
        return text
      } finally {
        calls.push({
          stage: 'draft',
          sessionId: session.sessionId,
          inputChars: system.length + transcript.length,
          outputChars: text.length,
        })
      }
    },
  })

  const recordingSecondRead =
    (session: Session): SecondReadCall =>
    async (draftText) => {
      let output = ''
      try {
        output = await model.secondRead(draftText, signal)
        return output
      } finally {
        calls.push({
          stage: 'gate',
          sessionId: session.sessionId,
          inputChars: SECOND_READ_PROMPT.length + draftText.length,
          outputChars: output.length,
        })
      }
    }

  const gateSummary = (gate: GateResult): GateSummary =>
    gate.passed
      ? { passed: true, rule: null, reason: null }
      : { passed: false, rule: gate.rule, reason: gate.reason }

  for (const { session } of candidates) {
    const agentId = session.scope
    const decide = (decision: Partial<Decision> & Pick<Decision, 'outcome'>) =>
      decisions.set(session.sessionId, {
        case: null,
        coveredBy: null,
        needsSetup: null,
        gate: null,
        draftResponse: null,
        failureSummary: '',
        ...decision,
      })

    const caseList =
      caseLists.get(agentId) ?? readLocalCaseList(agentId, casesDir)
    caseLists.set(agentId, caseList)

    let result: DraftResponse
    try {
      result = await draftCandidate(
        recordingDrafter(session),
        session,
        buildDraftingPrompt({
          agentId,
          fixtureDescription: caseList.fixtureDescription,
          currentConditions: caseList.conditions,
          recentProposals: recentProposalsForAgent(working, agentId, now),
        }),
        signal,
      )
    } catch (err) {
      if (!(err instanceof DraftingError)) throw err
      decide({
        outcome: DraftOutcome.error,
        failureSummary: err.message.slice(0, MAX_FAILURE_SUMMARY_LENGTH),
      })
      continue
    }
    const draftResponse = summarizeDraft(result)
    const { failureSummary } = result

    if (result.outcome === 'coveredBy') {
      decide({
        outcome: DraftOutcome.covered,
        coveredBy: result.caseId,
        draftResponse,
        failureSummary,
      })
      continue
    }
    if (result.outcome === 'needsSetup') {
      const gate = await gateNeedsSetup(
        result.what,
        sessionDenylist(session),
        sessionSourceTexts(session),
        recordingSecondRead(session),
      )
      decide({
        outcome: DraftOutcome.needsSetup,
        needsSetup: gate.passed ? result.what : WITHHELD_NEEDS_SETUP,
        gate: gateSummary(gate),
        draftResponse,
        failureSummary,
      })
      continue
    }

    const { conversationId } = session
    const duplicate = findDuplicate(
      working,
      conversationId,
      agentId,
      failureSummary,
      now,
    )
    if (duplicate) {
      decide({
        outcome: DraftOutcome.covered,
        coveredBy: duplicate.caseId ?? null,
        draftResponse,
        failureSummary,
      })
      continue
    }
    if (findRejection(working, conversationId, agentId, failureSummary, now)) {
      decide({
        outcome: DraftOutcome.suppressed,
        draftResponse,
        failureSummary,
      })
      continue
    }

    const draftedCase = buildDraftedCase(result.case)
    if (
      caseList.caseIds.has(draftedCase.caseId) ||
      proposedIds.has(draftedCase.caseId)
    ) {
      decide({
        outcome: DraftOutcome.error,
        draftResponse,
        failureSummary:
          `caseId ${draftedCase.caseId} collides with an existing or ` +
          'already-proposed case',
      })
      continue
    }

    const gate = await gateDraft(
      draftedCase,
      sessionDenylist(session),
      sessionSourceTexts(session),
      recordingSecondRead(session),
    )
    if (!gate.passed) {
      decide({
        outcome: DraftOutcome.gated,
        gate: gateSummary(gate),
        draftResponse,
        failureSummary: gate.reason,
      })
      continue
    }

    const passedGate = gateSummary(gate)
    const drift = findDateDrift({
      userTurns:
        draftedCase.turns ??
        (draftedCase.question === undefined ? [] : [draftedCase.question]),
      sourceTexts: sessionSourceTexts(session),
      sessionStartedAt: session.startedAt,
    })
    if (drift) {
      decide({
        outcome: DraftOutcome.heldForDate,
        case: draftedCase,
        gate: passedGate,
        draftResponse,
        failureSummary: drift.reason,
      })
      proposedIds.add(draftedCase.caseId)
      continue
    }
    if (caseList.caseCount >= LIST_SOFT_CAP) {
      decide({
        outcome: DraftOutcome.listFull,
        case: draftedCase,
        gate: passedGate,
        draftResponse,
        failureSummary,
      })
      continue
    }
    decide({
      outcome: DraftOutcome.proposed,
      case: draftedCase,
      gate: passedGate,
      draftResponse,
      failureSummary,
    })
    proposedIds.add(draftedCase.caseId)
    working.push({
      runId,
      conversationId,
      agentId,
      outcome: DraftOutcome.proposed,
      caseId: draftedCase.caseId,
      failureSummary,
      createdAt: now,
      closedAt: undefined,
    })
    caseLists.set(agentId, {
      ...caseList,
      caseCount: caseList.caseCount + 1,
    })
  }

  const allPlanted = [...new Set(fixtures.flatMap((f) => f.planted_pii))].sort(
    (a, b) => b.length - a.length,
  )
  const results = fixtures.map((fixture) => {
    const fixtureSessions = sessions.filter(
      (s) => s.conversationId === conversationIdOf(fixture),
    )
    return fixtureResult({
      fixture,
      sessionIds: fixtureSessions.map((s) => s.sessionId),
      scores,
      sessionErrors,
      decisions,
      calls,
      allPlanted,
      casesDir,
    })
  })
  return { runId, calls, scoringErrors, results }
}

const fixtureResult = ({
  fixture,
  sessionIds,
  scores,
  sessionErrors,
  decisions,
  calls,
  allPlanted,
  casesDir,
}: {
  fixture: BenchFixture
  sessionIds: string[]
  scores: Map<string, BenchScore>
  sessionErrors: Map<string, string>
  decisions: Map<string, Decision>
  calls: RecordedCall[]
  allPlanted: string[]
  casesDir: string
}): FixtureResult => {
  const [first] = sessionIds
  const score = first !== undefined ? (scores.get(first) ?? null) : null
  const scoringError =
    first !== undefined ? (sessionErrors.get(first) ?? null) : null
  const decision = first !== undefined ? decisions.get(first) : undefined
  const outcome = decision?.outcome ?? null
  const finalCase =
    decision && DRAFTED_OUTCOMES.has(decision.outcome) ? decision.case : null
  const touched =
    calls.some((call) => sessionIds.includes(call.sessionId)) ||
    decision !== undefined

  const checks: Record<string, Check> = {}
  const { expect } = fixture

  if (expect.scored) {
    checks.scored =
      sessionIds.length !== 1
        ? check(
            FAIL,
            `fixture split into ${sessionIds.length} sessions, expected 1`,
          )
        : score === null
          ? check(FAIL, scoringError ?? 'no parseable score')
          : check(PASS, `severity ${score.severity}`)
  } else {
    checks.ignored = touched
      ? check(FAIL, 'the scout scored or drafted a scope it does not cover')
      : check(PASS, 'never scored, no ledger line')
  }

  if (expect.should_draft) {
    if (finalCase) {
      checks.drafted = check(PASS, `outcome ${outcome}`)
    } else if (expect.drop_ok) {
      checks.drafted = check(
        PASS,
        `no draft (outcome ${outcome}), allowed for planted PII`,
      )
    } else if (
      outcome === DraftOutcome.covered &&
      decision?.coveredBy &&
      expect.also_pass_if_covered_by.includes(decision.coveredBy)
    ) {
      checks.drafted = check(
        PASS,
        `covered by ${decision.coveredBy}, an accepted alternative`,
      )
    } else {
      checks.drafted = check(FAIL, `expected a draft, got outcome ${outcome}`)
    }
  } else {
    checks.drafted = check(
      finalCase ? FAIL : PASS,
      outcome ? `outcome ${outcome}` : 'never a drafting candidate',
    )
  }

  if (expect.covered_by !== null) {
    checks.skipped_as_covered =
      outcome === DraftOutcome.covered
        ? check(
            PASS,
            `named ${decision?.coveredBy}, expected ${expect.covered_by}`,
          )
        : check(FAIL, `outcome ${outcome}`)
  }

  if (expect.pattern !== null) {
    if (score === null) {
      checks.pattern = check(FAIL, 'not scored')
    } else {
      const flagged = [
        ...new Set(
          score.requests
            .filter((r) => r.severity >= CANDIDATE_MIN_SEVERITY)
            .map((r) => r.knownPattern),
        ),
      ].sort()
      checks.pattern = check(
        flagged.includes(expect.pattern) ? PASS : FAIL,
        `expected ${expect.pattern}, scout flagged ` +
          (flagged.length > 0 ? flagged.join(', ') : 'nothing at severity 2+'),
      )
    }
  }

  if (finalCase) {
    const leaked = plantedPiiFound(
      { case: finalCase, failureSummary: decision?.failureSummary ?? '' },
      allPlanted,
    )
    checks.no_planted_pii =
      leaked.length > 0
        ? check(FAIL, `found ${leaked.join(', ')}`)
        : check(PASS)
    const schemaIssue = validateAgainstSchema(finalCase)
    checks.gate_schema = schemaIssue ? check(FAIL, schemaIssue) : check(PASS)
    const loaderIssue = draftLoaderIssue(fixture.agent, finalCase, casesDir)
    checks.judge_loader = loaderIssue ? check(FAIL, loaderIssue) : check(PASS)
  } else {
    const drafted = decision?.draftResponse?.case
    const detail =
      drafted && plantedPiiFound(drafted, allPlanted).length > 0
        ? 'the drafting call put planted PII in its case and the gate ' +
          'dropped it'
        : 'no draft'
    for (const name of ['no_planted_pii', 'gate_schema', 'judge_loader']) {
      checks[name] = check(NOT_APPLICABLE, detail)
    }
  }

  return {
    id: fixture.id,
    agent: fixture.agent,
    category: fixture.category,
    summary: fixture.summary,
    notes: fixture.notes,
    expect,
    sessionIds,
    score,
    scoringError,
    outcome,
    coveredBy: decision?.coveredBy ?? null,
    needsSetup: decision?.needsSetup ?? null,
    draftResponse: decision?.draftResponse ?? null,
    gate: decision?.gate ?? null,
    case: finalCase,
    checks,
    passed: Object.values(checks).every((c) => c.status !== FAIL),
    grades: { faithful: null, gradeable: null, fictional: null, note: '' },
  }
}
