import type { z } from 'zod'
import type { WorkerContext } from '@/jobs/jobs.registry'
import type { AgentTool } from './tools/tool'

export type AgentDefinition<
  I extends z.ZodType<{ organizationSlug: string }> = z.ZodType<{
    organizationSlug: string
  }>,
  O extends z.ZodType = z.ZodType,
> = {
  // The run's input. organizationSlug is the run's owner, and the whole input
  // is AgentRun.input and the run's first message.
  input: I
  // Checked when the model calls submitOutput. The input and output schemas
  // are the run's manifest, and their hash is its shapeHash (manifest.ts).
  output: O
  model: string
  // The system prompt.
  prompt: string
  // Every tool the agent has, by name. The name is the agent's, not the tool's:
  // the loop turns each entry into an AI SDK tool under its key.
  tools: Record<string, AgentTool>
  // Saves the validated output where the product reads it. It can run twice
  // for one run, so make it an upsert.
  onArtifact: (
    artifact: z.infer<O>,
    run: { runId: string; input: z.infer<I> },
    context: WorkerContext,
  ) => Promise<void>
}

// Erases the definition's own input and output types so every agent fits one
// registry type. onArtifact parses on the way in, so the runner can hand it
// whatever the run submitted and stored.
export const defineAgent = <
  I extends z.ZodType<{ organizationSlug: string }>,
  O extends z.ZodType,
>(
  definition: AgentDefinition<I, O>,
): AgentDefinition => ({
  ...definition,
  onArtifact: async (artifact, run, context) =>
    definition.onArtifact(
      definition.output.parse(artifact),
      { runId: run.runId, input: definition.input.parse(run.input) },
      context,
    ),
})
