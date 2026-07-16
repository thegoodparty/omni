import type {
  ChatAnchor,
  Ordinance,
  OrdinanceFlowStep,
} from '@goodparty_org/contracts'

// Build the ordinance_flow ChatAnchor for a conversation. Shared by the guided
// flow chat and the draft review chat so the resource id and snapshot fallback
// live in one place. `url` and `step` are the per-surface differences; the draft
// review chat uses step: 'review' to get its own conversation apart from the
// flow's draft-generation step.
export function buildOrdinanceAnchor(
  ordinance: Ordinance,
  { url, step }: { url: string; step: OrdinanceFlowStep },
): ChatAnchor {
  return {
    resourceType: 'ordinance',
    resourceId: ordinance.id,
    url,
    snapshot: {
      title: ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance',
      summary: ordinance.goalText ?? '',
    },
    step,
  }
}
