import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import type { AgentRun, Turn } from './agent-run'

// Job-agnostic renderer for a parsed CAP agent run. Given the typed AgentRun
// structure (from parseAgentRun), it draws a summary strip + a per-turn table
// with milestone tinting. Nothing here is meeting_briefing-specific, so any
// future job's run viewer can reuse it as-is.

// Subtle per-milestone row tints. Uses registered theme utilities at low
// opacity (allowed: opacity on a base token) so rows group visually without raw
// palette colors. Cycled by the milestone's first-seen order.
const MILESTONE_TINTS = [
  'bg-info/5',
  'bg-success/5',
  'bg-primary/5',
  'bg-secondary/10',
  'bg-tertiary/5',
  'bg-destructive/5',
]

const usd = (value: number): string =>
  value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`

const num = (value: number): string => value.toLocaleString('en-US')

const deltaLabel = (ms: number): string => {
  if (!ms) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

const toolLabel = (turn: Turn): string =>
  turn.toolCalls.length ? turn.toolCalls.map((c) => c.name).join(', ') : '—'

export type AgentRunDetailProps = {
  run: AgentRun
  runId?: string
}

const AgentRunDetail = ({ run, runId }: AgentRunDetailProps) => {
  const tintFor = new Map<string, string>()
  run.perMilestone.forEach((milestone, i) => {
    tintFor.set(milestone.name, MILESTONE_TINTS[i % MILESTONE_TINTS.length]!)
  })

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Agent run</h1>
        {runId ? (
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {runId}
          </p>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Total cost
          </div>
          <div className="text-xl font-semibold tabular-nums">
            ${run.totals.costUsd.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Turns
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {run.totals.turns}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Cache-read tokens
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {num(run.totals.tokens.cacheRead)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Output tokens
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {num(run.totals.tokens.output)}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Cost by milestone
        </h2>
        <div className="flex flex-wrap gap-2">
          {run.perMilestone.map((milestone) => (
            <div
              key={milestone.name}
              className={`rounded-md border border-border px-3 py-2 ${
                tintFor.get(milestone.name) ?? ''
              }`}
            >
              <div className="font-mono text-xs">{milestone.name}</div>
              <div className="text-sm font-semibold tabular-nums">
                {usd(milestone.costUsd)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {milestone.turns} turns
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b">
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead className="w-20 text-right">Δt</TableHead>
              <TableHead className="w-40">Milestone</TableHead>
              <TableHead>Tool calls</TableHead>
              <TableHead className="w-28 text-right">Cache read</TableHead>
              <TableHead className="w-24 text-right">Output</TableHead>
              <TableHead className="w-24 text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.turns.map((turn) => {
              const tint = tintFor.get(turn.milestone) ?? ''
              return (
                <TableRow key={turn.index} className={tint}>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {turn.index}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {deltaLabel(turn.deltaMs)}
                  </TableCell>
                  <TableCell className="align-top">
                    {turn.isMilestoneStart ? (
                      <span className="inline-block rounded bg-foreground px-1.5 py-0.5 font-mono text-xs text-background">
                        {turn.milestone}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {turn.milestone}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[520px] align-top whitespace-normal">
                    {turn.toolCalls.length ? (
                      <div className="flex flex-col gap-1">
                        {turn.toolCalls.map((call, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="shrink-0 font-mono text-xs font-semibold">
                              {call.name}
                            </span>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {call.summary}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {toolLabel(turn)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {num(turn.tokens.cacheRead)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {num(turn.tokens.output)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {usd(turn.costUsd)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default AgentRunDetail
