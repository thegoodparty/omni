import type {
  ChatAnchor,
  Ordinance,
  OrdinanceFlowStep,
} from '@goodparty_org/contracts'

// Build the ordinance_flow ChatAnchor for a conversation. Shared by the guided
// flow chat and the draft chat so the resource id and snapshot fallback live in
// one place. `url` and `step` are the only per-surface differences.
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
