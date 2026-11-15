import type { z } from 'zod'
import type { WorkerContext } from '@/jobs/jobs.registry'
import type { AgentTool } from './tools/tool'

export type AgentDefinition<
  I extends z.ZodType<{ organizationSlug: string }> = z.ZodType<{
    organizationSlug: string
  }>,
  O extends z.ZodType = z.ZodType,
> = {
  // The run's input, stored on ExperimentRun.params. organizationSlug is the
  // run's owner.
  input: I
  // Checked when the agent calls submitOutput, and hashed into the run's
  // shape (shapeHash.ts).
  output: O
  model: string
  // The system prompt.
  prompt: string
  tools: AgentTool[]
  // Saves the validated output where the product reads it.
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
