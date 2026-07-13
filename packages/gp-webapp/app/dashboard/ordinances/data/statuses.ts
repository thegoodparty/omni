import type { OrdinanceStatus } from '@goodparty_org/contracts'

// Display metadata for each ordinance status. Colors follow the Lovable
// prototype: draft green, in review amber, proposed red, passed blue, in
// progress / repealed neutral. Class strings are literal so Tailwind keeps them
// (dynamic `bg-${family}` would be purged).
interface StatusMeta {
  label: string
  // Filled subtle badge shown on an ordinance row.
  pillClass: string
  // Outline tally/filter chip (unselected) and its selected state.
  filterClass: string
  filterActiveClass: string
}

export const ORDINANCE_STATUS_META: Record<OrdinanceStatus, StatusMeta> = {
  in_progress: {
    label: 'In progress',
    pillClass: 'bg-muted text-muted-foreground',
    filterClass: 'border-border text-muted-foreground',
    filterActiveClass: 'border-foreground/30 bg-muted text-foreground',
  },
  draft: {
    label: 'Draft',
    pillClass: 'bg-success-light text-success-dark',
    filterClass: 'border-success/40 text-success-dark',
    filterActiveClass: 'border-success bg-success-light text-success-dark',
  },
  in_review: {
    label: 'In review',
    pillClass: 'bg-warning-light text-warning-dark',
    filterClass: 'border-warning/40 text-warning-dark',
    filterActiveClass: 'border-warning bg-warning-light text-warning-dark',
  },
  proposed: {
    label: 'Proposed',
    pillClass: 'bg-destructive-light text-destructive-dark',
    filterClass: 'border-destructive/40 text-destructive-dark',
    filterActiveClass:
      'border-destructive bg-destructive-light text-destructive-dark',
  },
  passed: {
    label: 'Passed',
    pillClass: 'bg-info-light text-info-dark',
    filterClass: 'border-info/40 text-info-dark',
    filterActiveClass: 'border-info bg-info-light text-info-dark',
  },
  repealed: {
    label: 'Repealed',
    pillClass: 'bg-muted text-muted-foreground',
    filterClass: 'border-border text-muted-foreground',
    filterActiveClass: 'border-foreground/30 bg-muted text-foreground',
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
