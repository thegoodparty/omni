// ENG-11592: reads the sweep's own report (the same markdown `report.ts`
// writes into the job summary and the PR's `<!-- universal-judge-verdict -->`
// comment — see judge.yml's "Run the judging step" and "Post the verdict")
// to decide what the guard's own "Universal judge (shadow)" check should say.
//
// Parsed from the report text rather than re-run from the stored records:
// the records live in the private judge bucket, behind the AWS role this
// file's caller (judge-guard.yml) deliberately never holds (its own header:
// "No AWS in judge-guard.yml"). The report is the one artifact already
// public on the run, and `report.ts`'s per-agent heading
// (`### ${score.agentId} — ${score.label}`, or `— refused`) is already a
// stable, tested format — this just reads it back.
import { GUARD_BASELINE_HEADING } from './guardBaseline'
import {
  AGENT_LABEL_TO_OUTCOME,
  cantSayNote,
  mapGuardOutcome,
  worstOutcome,
  type GuardCheckResult,
  type GuardOutcome,
} from './resultMapping'

// `### <agentId> — <label>` or `### <agentId> — refused`. Matches
// report.ts's two call sites for this heading shape; a heading for anything
// else in the report (arm capture windows, identical outputs, ...) uses
// different text and never an em dash, so this does not need to allowlist
// agent ids.
const AGENT_HEADING = /^### (\S+) — (.+)$/gm

export interface AgentOutcomeEntry {
  readonly agentId: string
  readonly outcome: GuardOutcome
}

// Keeps the agent id a `parseAgentOutcomes` caller never needed — the guard
// check collapses every agent to one worst outcome — but the ledger line
// does: `verdicts` is keyed per agent (ENG-11593's ledger line shape), and
// the baseline trailer only needs the agents that actually landed WORSE.
export const parseAgentOutcomeEntries = (
  report: string,
): readonly AgentOutcomeEntry[] => {
  const entries: AgentOutcomeEntry[] = []
  for (const match of report.matchAll(AGENT_HEADING)) {
    const agentId = match[1] ?? ''
    const label = (match[2] ?? '').trim()
    const outcome = AGENT_LABEL_TO_OUTCOME[label]
    // A label this map does not recognize (a report section this guard was
    // never told about) is read as an infra error rather than ignored: a
    // silent "no match" here would let an unrecognized-but-real verdict pass
    // the check as a quiet `no_agent_reached`, which is the "pass" accident
    // the dropped-id test plan in picker.ts guards against for the same
    // reason.
    entries.push({ agentId, outcome: outcome ?? 'infra_error' })
  }
  return entries
}

export const parseAgentOutcomes = (report: string): readonly GuardOutcome[] =>
  parseAgentOutcomeEntries(report).map((entry) => entry.outcome)

export interface GuardVerdict extends GuardCheckResult {
  readonly outcome: GuardOutcome
}

// ENG-11593: whichever trusted step posts the sweep's result (judge.yml's
// own sweep job, which holds the AWS role) reads each WORSE agent's
// main-vs-main baseline from S3 and appends `formatGuardBaselineTrailer`'s
// text to report.md under this heading, before this guard job — which holds
// no AWS role at all — ever sees the file. So wiring the trailer into the
// WORSE note here is just finding that already-rendered section and
// forwarding it; this file never touches a baseline object itself.
const extractBaselineTrailer = (report: string): string | undefined => {
  const index = report.indexOf(GUARD_BASELINE_HEADING)
  return index === -1 ? undefined : report.slice(index).trimEnd()
}

// `report` is `undefined` when the artifact never arrived (the dispatched
// sweep run failed before the judging step wrote one, or the guard's own
// poll gave up) — read as an infra error, same bucket as a parsed `refused`.
export const resolveGuardVerdict = (
  report: string | undefined,
): GuardVerdict => {
  if (report === undefined) {
    return { outcome: 'infra_error', ...mapGuardOutcome('infra_error') }
  }
  // A report with zero agent headings is not "no agent reached": this
  // function only runs once the cap let agents run, so an empty parse means
  // the judging step crashed or was killed before writing its summary (the
  // EXIT trap in judge.yml still uploads whatever partial file exists). Read
  // that as an infra error rather than the quiet pass `worstOutcome([])`
  // would otherwise produce (delegate-reviewer, ENG-11592 correction).
  const entries = parseAgentOutcomeEntries(report)
  const outcomes = entries.map((entry) => entry.outcome)
  const outcome = outcomes.length === 0 ? 'infra_error' : worstOutcome(outcomes)
  const mapped = mapGuardOutcome(outcome)
  if (outcome === "CAN'T SAY") {
    const cantSay = entries
      .filter((entry) => entry.outcome === "CAN'T SAY")
      .map((entry) => entry.agentId)
    return {
      outcome,
      conclusion: mapped.conclusion,
      note: cantSayNote(cantSay),
    }
  }
  if (outcome !== 'WORSE') return { outcome, ...mapped }
  const trailer = extractBaselineTrailer(report)
  return {
    outcome,
    conclusion: mapped.conclusion,
    note: trailer === undefined ? mapped.note : `${mapped.note}\n\n${trailer}`,
  }
}
