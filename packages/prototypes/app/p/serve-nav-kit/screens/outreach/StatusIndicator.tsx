import { type HistoryStatus, STATUS_META } from './data'

// One status indicator (blue icon + label), reused in the table, mobile cards, and
// the drawer header so the status reads the same everywhere.
export const StatusIndicator = ({ status }: { status: HistoryStatus }) => {
  const st = STATUS_META[status]
  return (
    <span className="text-primary inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
      <st.icon className="size-4" />
      {st.label}
    </span>
  )
}
