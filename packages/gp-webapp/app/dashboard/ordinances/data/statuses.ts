import type { OrdinanceStatus } from '@goodparty_org/contracts'

// Display metadata for each ordinance status. Colors follow the Lovable
// prototype: draft green, in review amber, proposed red, passed blue, in
// progress / repealed neutral. Class strings are literal so Tailwind keeps them
// (dynamic `bg-${family}` would be purged).
interface StatusMeta {
  label: string
  // Filled subtle badge shown on an ordinance row.
  pillClass: string
  // Tinted tally/filter chip (unselected) and its selected state. Both are
  // filled to match the Lovable prototype; selection adds a colored border.
  filterClass: string
  filterActiveClass: string
}

export const ORDINANCE_STATUS_META: Record<OrdinanceStatus, StatusMeta> = {
  in_progress: {
    label: 'In progress',
    pillClass: 'border-border bg-muted text-muted-foreground',
    filterClass: 'border-border bg-muted text-muted-foreground',
    filterActiveClass: 'border-foreground/40 bg-muted text-foreground',
  },
  draft: {
    label: 'Draft',
    pillClass: 'border-success/40 bg-success/10 text-success-dark',
    filterClass: 'border-success/50 bg-success/10 text-success-dark',
    filterActiveClass: 'border-success bg-success/20 text-success-dark',
  },
  in_review: {
    label: 'In review',
    pillClass: 'border-warning/40 bg-warning/10 text-warning-dark',
    filterClass: 'border-warning/50 bg-warning/10 text-warning-dark',
    filterActiveClass: 'border-warning bg-warning/20 text-warning-dark',
  },
  proposed: {
    label: 'Proposed',
    pillClass: 'border-destructive/40 bg-destructive/10 text-destructive-dark',
    filterClass:
      'border-destructive/50 bg-destructive/10 text-destructive-dark',
    filterActiveClass:
      'border-destructive bg-destructive/20 text-destructive-dark',
  },
  passed: {
    label: 'Passed',
    pillClass: 'border-info/40 bg-info/10 text-info-dark',
    filterClass: 'border-info/50 bg-info/10 text-info-dark',
    filterActiveClass: 'border-info bg-info/20 text-info-dark',
  },
  repealed: {
    label: 'Repealed',
    pillClass: 'border-border bg-muted text-muted-foreground',
    filterClass: 'border-border bg-muted text-muted-foreground',
    filterActiveClass: 'border-foreground/40 bg-muted text-foreground',
  },
}

// Order for the status tally/filter row (matches the Lovable prototype).
export const ORDINANCE_STATUS_ORDER: readonly OrdinanceStatus[] = [
  'in_progress',
  'draft',
  'in_review',
  'proposed',
  'passed',
  'repealed',
]
