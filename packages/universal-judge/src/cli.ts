/**
 * Entry point for both humans and CI.
 *
 * The workflow calls exactly the same command an engineer would type, so a run
 * that misbehaves in CI can be reproduced locally without reading any YAML.
 */

import { writeFileSync } from 'node:fs'
import { summarise, type Summary } from './aggregate.js'
import { makeClient, DEFAULT_JUDGE_MODEL } from './pairwise.js'
import { agentByName, catalogue, resolveAgent } from './registry.js'
import { COMMENT_MARKER, renderComment } from './report.js'
import { runAgent } from './run.js'
import { estimateCost, isTriggered, parseSpec, type JobSpec } from './spec.js'
import type { AgentResult, Variant } from './types.js'

const USAGE = `universal-judge — blind graded-pairwise A/B evaluation for GoodParty agents

Usage:
  npm run judge -w packages/universal-judge -- [options]

Options:
  --comment <text>          Natural-language request, e.g. "run the universal judge on community issues".
  --agents <a,b>            Explicit agent list, bypassing comment parsing.
  --samples <n>             Cases per agent.
  --baseline-ref <ref>      Git ref the baseline represents (default: main).
  --candidate-ref <ref>     Git ref the candidate represents (default: current branch name or "candidate").
  --experiments-dir <path>  packages/runbooks/experiments in the candidate checkout.
  --baseline-checkout <p>   Repo root for the baseline, required for foreground agents.
  --candidate-checkout <p>  Repo root for the candidate, required for foreground agents.
  --env <dev|prod>          Which environment to dispatch into (default: dev).
  --judge-model <id>        Judge model (default: ${DEFAULT_JUDGE_MODEL}).
  --refresh-baseline        Re-run the baseline instead of reusing cached outputs.
  --out <path>              Write the rendered PR comment here.
  --plan-out <path>         Write the resolved plan as JSON and stop. Used by CI to decide
                            which packages it needs to install before running.
  --dry-run                 Resolve the job and print the plan and cost estimate, then stop.
  --requested-by <login>    Attribute the run in the comment.

Agents:
${catalogue()}
`

type Args = Record<string, string | boolean>

const parseArgs = (argv: string[]): Args => {
  const args: Args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const name = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[name] = true
    } else {
      args[name] = next
      i += 1
    }
  }
  return args
}

const str = (args: Args, name: string) =>
  typeof args[name] === 'string' ? (args[name] as string) : undefined

/** Short, filesystem- and id-safe tag derived from a ref. */
const tagFor = (ref: string) =>
  ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'ref'

export const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv)
  if (args.help || args.h) {
    console.log(USAGE)
    return 0
  }

  const comment = str(args, 'comment')
  const explicit = str(args, 'agents')

  let spec: JobSpec
  if (explicit) {
    const agents: string[] = []
    const notes: string[] = []
    for (const token of explicit
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)) {
      const agent = resolveAgent(token)
      if (!agent) {
        notes.push(`Ignored unrecognised agent name "${token}".`)
        continue
      }
      if (!agents.includes(agent.name)) agents.push(agent.name)
    }
    spec = {
      agents,
      samplesPerAgent: Number(str(args, 'samples') ?? 3),
      refreshBaseline: Boolean(args['refresh-baseline']),
      notes,
    }
  } else {
    if (!comment) {
      console.error('Pass --comment or --agents. See --help.')
      return 2
    }
    if (!isTriggered(comment)) {
      console.log(
        'Comment does not ask for the universal judge; nothing to do.',
      )
      return 0
    }
    spec = await parseSpec(comment, safeClient())
    if (str(args, 'samples'))
      spec.samplesPerAgent = Number(str(args, 'samples'))
    if (args['refresh-baseline']) spec.refreshBaseline = true
  }

  // CI resolves the plan first so it knows whether it needs to install gp-api in
  // both checkouts, which is only worth doing when a foreground agent is asked for.
  const planOut = str(args, 'plan-out')
  if (planOut) {
    const kinds = spec.agents.map((name) => agentByName(name).kind)
    writeFileSync(
      planOut,
      JSON.stringify(
        {
          agents: spec.agents,
          samplesPerAgent: spec.samplesPerAgent,
          refreshBaseline: spec.refreshBaseline,
          hasForeground: kinds.includes('foreground'),
          hasBackground: kinds.includes('background'),
          estimatedCostUsd: Number(estimateCost(spec).toFixed(2)),
          notes: spec.notes,
        },
        null,
        2,
      ),
    )
    console.log(`Wrote plan to ${planOut}`)
    return 0
  }

  if (!spec.agents.length) {
    const body = [
      COMMENT_MARKER,
      '## Universal judge',
      '',
      "I could not tell which agents to evaluate. Name one or more and I'll run them.",
      '',
      '**Available agents**',
      '',
      catalogue(),
      '',
      spec.notes.map((n) => `> ${n}`).join('\n'),
    ].join('\n')
    emit(body, str(args, 'out'))
    return 0
  }

  const baselineRef = str(args, 'baseline-ref') ?? 'main'
  const candidateRef = str(args, 'candidate-ref') ?? 'candidate'
  const baseline: Variant = {
    role: 'baseline',
    ref: baselineRef,
    tag: tagFor(baselineRef),
  }
  const candidate: Variant = {
    role: 'candidate',
    ref: candidateRef,
    tag: tagFor(candidateRef),
  }

  const plan =
    `Agents: ${spec.agents.join(', ')} | ${spec.samplesPerAgent} case(s) each | ` +
    `baseline ${baseline.ref} vs candidate ${candidate.ref} | ` +
    `estimated agent spend up to $${estimateCost(spec).toFixed(2)}`
  console.log(plan)

  if (args['dry-run']) {
    console.log('Dry run; nothing dispatched.')
    for (const note of spec.notes) console.log(`note: ${note}`)
    return 0
  }

  const client = makeClient()
  const judgeModel = str(args, 'judge-model') ?? DEFAULT_JUDGE_MODEL
  const env = str(args, 'env') ?? 'dev'
  const experimentsDir =
    str(args, 'experiments-dir') ??
    `${str(args, 'candidate-checkout') ?? process.cwd()}/packages/runbooks/experiments`

  const sections: { result: AgentResult; summary: Summary }[] = []
  for (const agentName of spec.agents) {
    try {
      const result = await runAgent({
        agentName,
        baseline,
        candidate,
        env,
        experimentsDir,
        baselineCheckout: str(args, 'baseline-checkout'),
        candidateCheckout: str(args, 'candidate-checkout'),
        samples: spec.samplesPerAgent,
        refreshBaseline: spec.refreshBaseline,
        client,
        judgeModel,
        log: (message) => console.log(`  ${message}`),
      })
      result.notes.push(...spec.notes)
      sections.push({ result, summary: summarise(result) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${agentName}: ${message}`)
      const failed: AgentResult = {
        agent: agentName,
        verdicts: [],
        runs: [],
        notes: [`This agent could not be evaluated: ${message}`, ...spec.notes],
      }
      sections.push({ result: failed, summary: summarise(failed) })
    }
  }

  const body = renderComment({
    sections,
    baseline,
    candidate,
    judgeModel,
    requestedBy: str(args, 'requested-by'),
  })
  emit(body, str(args, 'out'))
  return 0
}

const emit = (body: string, outPath: string | undefined) => {
  if (outPath) {
    writeFileSync(outPath, body)
    console.log(`Wrote comment to ${outPath}`)
  } else {
    console.log(`\n${body}`)
  }
}

/** The spec parser degrades to alias matching when no key is configured. */
const safeClient = () => {
  try {
    return makeClient()
  } catch {
    return undefined
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
