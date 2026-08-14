import type {
  ChatAnchor,
  Ordinance,
  OrdinanceFlowStep,
} from '@goodparty_org/contracts'

// Snapshot fields are just display labels for the conversation, but the anchor
// schema caps them (ChatAnchorSnapshotSchema: title max 500, summary max 5000).
// goalText is uncapped at creation, so a long "complex idea" would otherwise
// overflow `title` and get the whole anchor rejected — surfacing as a dead-end
// "couldn't open this step" error. Clamp here; the full goalText still lives on
// the ordinance record for the flow to use.
const MAX_TITLE = 500
const MAX_SUMMARY = 5_000

// Build the ordinance_flow ChatAnchor for a conversation. Shared by the guided
// flow chat and the draft review chat so the resource id and snapshot fallback
// live in one place. `url` and `step` are the per-surface differences; the draft
// review chat uses step: 'review' to get its own conversation apart from the
// flow's draft-generation step.
export function buildOrdinanceAnchor(
  ordinance: Ordinance,
  { url, step }: { url: string; step: OrdinanceFlowStep },
): ChatAnchor {
  const title =
    ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance'
  return {
    resourceType: 'ordinance',
    resourceId: ordinance.id,
    url,
    snapshot: {
      title: title.slice(0, MAX_TITLE),
      summary: (ordinance.goalText ?? '').slice(0, MAX_SUMMARY),
    },
    step,
  }
}
