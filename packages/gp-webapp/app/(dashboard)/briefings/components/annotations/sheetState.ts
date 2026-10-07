import type { ResolvedAnchor } from '@shared/briefings/anchorResolver'
import type { Annotation, AnnotationAnchor } from '@shared/briefings/types'

/**
 * Either an in-progress selection-driven anchor, or null for a top-level
 * (page-scoped) annotation.
 */
export type PendingAnchor = ResolvedAnchor | null

/**
 * Overlay state — covers the right-side cycler surfaces and the legacy
 * AddNote / ReportError single-annotation sheets. One overlay is open at
 * a time. Chats no longer have their own legacy sheet; they share the
 * cycler surface with the rest of the annotation kinds.
 */
export type OverlayState =
  | { kind: 'closed' }
  | { kind: 'add_note_new'; anchor: PendingAnchor }
  | { kind: 'add_note_edit'; annotation: Annotation }
  | { kind: 'report_error_new'; anchor: PendingAnchor }
  | { kind: 'report_error_view'; annotation: Annotation }
  | { kind: 'surface_notes'; initialAnnotationId?: string }
  | {
      kind: 'surface_chats'
      initialAnnotationId?: string
      pendingAnchor?: AnnotationAnchor
    }
  | { kind: 'surface_bug_reports'; initialAnnotationId?: string }

/**
 * Legacy alias retained for external imports — overlays now include
 * popovers as well as sheets, but the type name is preserved to avoid a
 * cross-file rename.
 */
export type SheetState = OverlayState
