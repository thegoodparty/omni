import type { z } from 'zod'
import type { BackgroundAgentDefinition } from './types'

// Erases the definition's own input and output types so every agent fits one
// registry type. onArtifact validates on the way in, so an engine can hand it
// whatever the run submitted.
export const defineAgent = <I extends z.ZodType, O extends z.ZodType>(
  definition: BackgroundAgentDefinition<I, O>,
): BackgroundAgentDefinition<z.ZodType, z.ZodType> => ({
  ...definition,
  onArtifact: async (artifact, run, moduleRef) =>
    definition.onArtifact(
      definition.output.parse(artifact),
      { runId: run.runId, input: definition.input.parse(run.input) },
      moduleRef,
    ),
})
