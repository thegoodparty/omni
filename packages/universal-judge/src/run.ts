/**
 * Orchestrate one agent's comparison: produce both sides, judge, aggregate.
 *
 * Both sides of a case are produced before anything is judged, and every case is
 * produced concurrently. Background runs take minutes each and the platform's own
 * scheduler serialises them against its concurrency cap, so dispatching in
 * parallel and waiting is both faster and no harder on the queue than a loop.
 */

import type Anthropic from '@anthropic-ai/sdk'
import {
  dispatch,
  indexHas,
  pollRun,
  publishClone,
  unpublishClone,
} from './adapters/capBackground.js'
import { produceForeground } from './adapters/gpApiForeground.js'
import { readBaseline, toOutcome, writeBaseline } from './baselineCache.js'
import { loadCases, slugFor } from './cases.js'
import { judgePair, loadRubric } from './pairwise.js'
import { agentByName } from './registry.js'
import type {
  AgentResult,
  Case,
  CaseVerdict,
  RunOutcome,
  Variant,
} from './types.js'

export type RunOptions = {
  agentName: string
  baseline: Variant
  candidate: Variant
  env: string
  /** Path to packages/runbooks/experiments in the candidate checkout. */
  experimentsDir: string
  /** Path to the baseline checkout, for foreground agents. */
  baselineCheckout?: string
  /** Path to the candidate checkout, for foreground agents. */
  candidateCheckout?: string
  samples: number
  refreshBaseline: boolean
  client: Anthropic
  judgeModel?: string
  log?: (message: string) => void
}

export const runAgent = async (options: RunOptions): Promise<AgentResult> => {
  const agent = agentByName(options.agentName)
  const cases = loadCases(agent.name, options.samples)
  const notes: string[] = []
  const log = options.log ?? (() => {})

  log(`${agent.name}: ${cases.length} case(s), ${agent.kind} agent`)

  const { runs, cleanup } =
    agent.kind === 'background'
      ? await produceBackground(agent.experimentId!, cases, options, notes, log)
      : await produceForegroundPair(cases, options, log)

  try {
    const verdicts = await judgeAll(
      agent.name,
      cases,
      runs,
      options,
      notes,
      log,
    )
    return { agent: agent.name, verdicts, runs, notes }
  } catch (error) {
    // Producing those runs cost real money. A judging failure must not throw them
    // away — report what was produced, and say why it could not be scored.
    const message = error instanceof Error ? error.message : String(error)
    notes.push(`Outputs were produced but could not be judged: ${message}`)
    return { agent: agent.name, verdicts: [], runs, notes }
  } finally {
    await cleanup()
  }
}

const produceBackground = async (
  experimentId: string,
  cases: Case[],
  options: RunOptions,
  notes: string[],
  log: (m: string) => void,
) => {
  const candidateExperimentId = await publishClone({
    experimentsDir: options.experimentsDir,
    experimentId,
    tag: options.candidate.tag,
    env: options.env,
  })
  log(`published candidate as ${candidateExperimentId}`)

  const cleanup = async () => {
    await unpublishClone(candidateExperimentId, options.env)
    log(`removed ${candidateExperimentId}`)
  }

  try {
    // The baseline is whatever main already published; it is never re-published.
    if (!(await indexHas(experimentId, options.env))) {
      throw new Error(
        `baseline experiment "${experimentId}" is not in the ${options.env} index, so there is nothing to compare against`,
      )
    }

    const work = cases.map(async (testCase) => {
      const cached = options.refreshBaseline
        ? undefined
        : await readBaseline({
            agent: options.agentName,
            ref: options.baseline.ref,
            caseId: testCase.id,
            env: options.env,
          })

      if (cached) log(`${testCase.id}: baseline from cache`)

      // Both sides go out together. Each run takes minutes, so producing them in
      // sequence would double the wall-clock a reviewer waits on for no benefit.
      return Promise.all([
        cached
          ? toOutcome(cached, testCase.id)
          : dispatchAndPoll(experimentId, testCase, 'baseline', options, log),
        dispatchAndPoll(
          candidateExperimentId,
          testCase,
          'candidate',
          options,
          log,
        ),
      ])
    })

    const runs = (await Promise.all(work)).flat()

    await Promise.all(
      runs
        // Only freshly dispatched runs need writing; a cache hit has no runId.
        .filter(
          (r) =>
            r.variant === 'baseline' &&
            r.status === 'ok' &&
            r.runId !== undefined,
        )
        .map((outcome) =>
          writeBaseline({
            agent: options.agentName,
            ref: options.baseline.ref,
            caseId: outcome.caseId,
            env: options.env,
            outcome,
          }),
        ),
    )

    const cachedCount = runs.filter(
      (r) => r.variant === 'baseline' && r.runId === undefined,
    ).length
    if (cachedCount) {
      notes.push(
        `${cachedCount} baseline output(s) reused from cache for \`${options.baseline.ref}\`. Say "refresh baseline" to re-run them.`,
      )
    }

    return { runs, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

const dispatchAndPoll = async (
  experimentId: string,
  testCase: Case,
  variant: 'baseline' | 'candidate',
  options: RunOptions,
  log: (m: string) => void,
): Promise<RunOutcome> => {
  const tag =
    variant === 'baseline' ? options.baseline.tag : options.candidate.tag
  const organizationSlug = slugFor(options.agentName, testCase.id, tag)
  const params = { ...testCase.params, organization_slug: organizationSlug }

  try {
    const dispatchedAt = Date.now()
    const runId = await dispatch({
      experimentId,
      organizationSlug,
      params,
      env: options.env,
    })
    log(`${testCase.id}/${variant}: dispatched ${runId}`)

    const outcome = await pollRun({
      experimentId,
      runId,
      caseId: testCase.id,
      variant,
      env: options.env,
      dispatchedAt,
    })
    log(`${testCase.id}/${variant}: ${outcome.status}`)
    return outcome
  } catch (error) {
    return {
      caseId: testCase.id,
      variant,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const produceForegroundPair = async (
  cases: Case[],
  options: RunOptions,
  log: (m: string) => void,
) => {
  if (!options.baselineCheckout || !options.candidateCheckout) {
    throw new Error(
      'a foreground agent needs both --baseline-checkout and --candidate-checkout, since its variant is the working tree',
    )
  }

  const runs: RunOutcome[] = []
  for (const testCase of cases) {
    runs.push(
      await produceForeground({
        agent: options.agentName,
        testCase,
        variant: 'baseline',
        checkout: options.baselineCheckout,
        log,
      }),
    )
    runs.push(
      await produceForeground({
        agent: options.agentName,
        testCase,
        variant: 'candidate',
        checkout: options.candidateCheckout,
        log,
      }),
    )
  }

  return { runs, cleanup: async () => {} }
}

const judgeAll = async (
  agentName: string,
  cases: Case[],
  runs: RunOutcome[],
  options: RunOptions,
  notes: string[],
  log: (m: string) => void,
): Promise<CaseVerdict[]> => {
  const rubric = loadRubric(agentName)
  const verdicts: CaseVerdict[] = []
  let skipped = 0

  for (const testCase of cases) {
    const baseline = runs.find(
      (r) => r.caseId === testCase.id && r.variant === 'baseline',
    )
    const candidate = runs.find(
      (r) => r.caseId === testCase.id && r.variant === 'candidate',
    )

    // A case is only comparable when both sides produced something. A failure on
    // one side is reported in the failures list, never scored as a loss — a run
    // that timed out says nothing about output quality.
    if (baseline?.status !== 'ok' || candidate?.status !== 'ok') {
      skipped += 1
      continue
    }

    verdicts.push(
      await judgePair({
        caseId: testCase.id,
        input: testCase.params,
        baselineOutput: baseline.output,
        candidateOutput: candidate.output,
        agent: agentName,
        client: options.client,
        model: options.judgeModel,
        rubric,
      }),
    )
    log(`${testCase.id}: judged`)
  }

  if (skipped) {
    notes.push(
      `${skipped} case(s) could not be judged because at least one side failed to produce an output.`,
    )
  }
  return verdicts
}
