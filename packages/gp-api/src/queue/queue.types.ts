import type {
  FeedbackSynthesisCompleteEvent,
  PanelRepliesUploadedEvent,
} from '@goodparty_org/contracts'
import z from 'zod'

export enum QueueType {
  POLL_ANALYSIS_COMPLETE = 'pollAnalysisComplete',
  // Published by the polls synthesis pipeline when it has grouped an issue
  // capture run's memos. Shape: FeedbackSynthesisCompleteEventSchema in
  // @goodparty_org/contracts.
  FEEDBACK_SYNTHESIS_COMPLETE = 'feedbackSynthesisComplete',
  // EventBridge's translation of the swarm's S3 upload of a wave's reply
  // export. Shape: PanelRepliesUploadedEventSchema in @goodparty_org/contracts.
  PANEL_REPLIES_UPLOADED = 'panelRepliesUploaded',
  AGENT_EXPERIMENT_RESULT = 'agentExperimentResult',
}

export type QueueMessage =
  | {
      type: QueueType.POLL_ANALYSIS_COMPLETE
      data: PollAnalysisCompleteEvent['data']
    }
  | {
      type: QueueType.FEEDBACK_SYNTHESIS_COMPLETE
      data: FeedbackSynthesisCompleteEvent['data']
    }
  | {
      type: QueueType.PANEL_REPLIES_UPLOADED
      data: PanelRepliesUploadedEvent
    }
  | {
      type: QueueType.AGENT_EXPERIMENT_RESULT
      data: AgentExperimentResultData
    }

export const PollAnalysisCompleteEventSchema = z.object({
  type: z.literal(QueueType.POLL_ANALYSIS_COMPLETE),
  data: z.object({
    pollId: z.string(),
    totalResponses: z.number(),
    responsesLocation: z.string(),
    // Whether the cluster-analysis theme prompt came from the hosted
    // Braintrust build or the in-repo fallback. Optional because the
    // pipeline image deploys separately from gp-api and an older pipeline
    // build sends no such field at all. This event has no contracts
    // counterpart (unlike FeedbackSynthesisCompleteEventSchema) — it is
    // typed only here.
    promptSource: z.enum(['hosted', 'fallback']).optional(),
    issues: z.array(
      z.object({
        pollId: z.string(),
        rank: z.number().min(1).max(3),
        theme: z.string(),
        summary: z.string(),
        analysis: z.string(),
        responseCount: z.number(),
        quotes: z.array(
          z.object({ quote: z.string(), phone_number: z.string() }),
        ),
      }),
    ),
  }),
})
export type PollAnalysisCompleteEvent = z.infer<
  typeof PollAnalysisCompleteEventSchema
>

export enum SqsConsumerErrorEventName {
  ERROR = 'error',
  PROCESSING_ERROR = 'processing_error',
  TIMEOUT_ERROR = 'timeout_error',
}

const PollResponseJsonRowSchema = z.object({
  atomicId: z.string(),
  phoneNumber: z.string(),
  receivedAt: z.string(),
  originalMessage: z.string(),
  atomicMessage: z.string(),
  pollId: z.string(),
  clusterId: z.union([z.number(), z.string()]), // Empty string for opt-out rows
  theme: z.string(),
  category: z.string(),
  summary: z.string(),
  sentiment: z.string(),
  isOptOut: z.boolean(),
})

export type PollResponseJsonRow = z.infer<typeof PollResponseJsonRowSchema>

export const PollClusterAnalysisJsonSchema = z.array(PollResponseJsonRowSchema)
export type PollClusterAnalysisJson = z.infer<
  typeof PollClusterAnalysisJsonSchema
>

export const AgentExperimentResultSchema = z.object({
  runId: z.string(),
  status: z.enum(['started', 'success', 'failed', 'contract_violation']),
  artifactKey: z.string().optional(),
  artifactBucket: z.string().optional(),
  durationSeconds: z.number().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
})

export type AgentExperimentResultData = z.infer<
  typeof AgentExperimentResultSchema
>
