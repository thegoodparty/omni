/**
 * The set of agents the universal judge knows how to evaluate.
 *
 * Adding an agent is meant to be a data change, not a code change: name it, say
 * which adapter produces its outputs, add a golden-case file, and optionally drop
 * a rubric addendum next to the universal rubric. Everything downstream —
 * dispatch, judging, aggregation, the PR comment — is agent-agnostic.
 *
 * `kind` is the only thing that changes how an output gets produced:
 *
 *   background  a CAP agent. The variant is a manifest published under a
 *               ref-scoped experiment id; runs go through SQS and land in S3.
 *   foreground  an in-process gp-api chat agent. The variant is the working tree
 *               itself; runs happen in a local harness.
 */

export type AgentKind = 'background' | 'foreground'

export type Agent = {
  name: string
  kind: AgentKind
  description: string
  aliases: string[]
  /** background only: the published experiment id this agent's manifest lives under */
  experimentId?: string
  /** foreground only: which harness entrypoint drives it */
  harness?: string
  /** Rough per-run cost, used to price a job before it is allowed to spend anything */
  estCostPerRunUsd: number
}

export const AGENTS: Agent[] = [
  {
    name: 'meeting_briefing',
    kind: 'background',
    description:
      'Pre-meeting briefing for an elected official, built from an agenda.',
    aliases: ['meeting briefings', 'meeting briefing', 'briefings', 'briefing'],
    experimentId: 'meeting_briefing',
    estCostPerRunUsd: 6,
  },
  {
    name: 'top_community_issues',
    kind: 'background',
    description: 'Ranked list of the top issues in a jurisdiction.',
    aliases: [
      'community issues',
      'top community issues',
      'issues',
      'community issue',
    ],
    experimentId: 'top_community_issues',
    estCostPerRunUsd: 1.8,
  },
  {
    name: 'find_existing_ordinances',
    kind: 'background',
    description:
      "Locates a jurisdiction's codified ordinances and captures the code.",
    aliases: ['existing ordinances', 'ordinance lookup', 'code lookup'],
    experimentId: 'find_existing_ordinances',
    estCostPerRunUsd: 1.5,
  },
  {
    name: 'ordinance_draft',
    kind: 'foreground',
    description: 'Drafts ordinance text in the ordinance flow (draft step).',
    aliases: ['ordinances', 'ordinance', 'ordinance draft', 'ordinance flow'],
    harness: 'ordinance_draft',
    estCostPerRunUsd: 0.6,
  },
]

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

export const resolveAgent = (token: string): Agent | undefined => {
  const key = normalise(token)
  return AGENTS.find(
    (agent) =>
      normalise(agent.name) === key ||
      agent.aliases.some((a) => normalise(a) === key),
  )
}

export const agentByName = (name: string): Agent => {
  const agent = AGENTS.find((a) => a.name === name)
  if (!agent) throw new Error(`unknown agent: ${name}`)
  return agent
}

/** Human-readable list, used in the spec prompt and in --help output. */
export const catalogue = () =>
  AGENTS.map(
    (a) =>
      `- ${a.name} (${a.kind}): ${a.description} ` +
      `[~$${a.estCostPerRunUsd.toFixed(2)}/run; also called: ${a.aliases.join(', ')}]`,
  ).join('\n')
