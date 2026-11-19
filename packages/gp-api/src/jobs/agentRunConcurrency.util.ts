// agentRun's slots per task, and the cap across the fleet.
export const AGENT_RUN_MAX_CONCURRENT = 10
const AGENT_RUN_CONCURRENCY = 2

// A preview is one task with no autoscaling, so nothing else can add its
// slots: it runs the whole fleet cap itself. Dev and prod autoscale up to
// that cap two slots a task.
export const agentRunConcurrency = (
  otelServiceEnvironment: string | undefined,
): number =>
  otelServiceEnvironment === 'preview'
    ? AGENT_RUN_MAX_CONCURRENT
    : AGENT_RUN_CONCURRENCY
