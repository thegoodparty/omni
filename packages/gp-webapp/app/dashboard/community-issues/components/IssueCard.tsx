import Link from 'next/link'
import { Badge } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import { categoryDisplay } from './categoryDisplay'

export const priorityVariant = (
  priority: string,
): { className: string; label: string } => {
  if (priority === 'high') {
    return {
      className: 'bg-destructive text-destructive-foreground',
      label: 'High',
    }
  }
  if (priority === 'medium') {
    return {
      className: 'bg-warning-background text-warning-dark',
      label: 'Medium',
    }
  }
  return { className: 'bg-success-background text-success-dark', label: 'Low' }
}

export const issueHref = (id: string) => `/dashboard/community-issues/${id}`

// A single row in a continuous (divider-separated) issue list. The enclosing
// list provides the border + dividers; the row darkens on hover.
const IssueCard = ({
  issue,
  showCategory = false,
}: {
  issue: CommunityIssueCard
  showCategory?: boolean
}): React.JSX.Element => {
  const severity = priorityVariant(issue.priority)
  const { label: categoryLabel, Icon: CategoryIcon } = categoryDisplay(
    issue.category,
  )

  return (
    <Link
      href={issueHref(issue.id)}
      className="relative flex flex-col gap-2 p-4 transition-colors hover:bg-muted"
    >
      <Badge className={`absolute right-4 top-4 ${severity.className}`}>
        {severity.label}
      </Badge>
      {showCategory ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CategoryIcon className="size-4" aria-hidden />
          {categoryLabel}
        </span>
      ) : null}
      <div className="flex items-center gap-2 pr-16">
        {issue.rank !== null ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-info-600 text-xs font-semibold text-info-contrast">
            {issue.rank}
          </span>
        ) : null}
        <h3 className="text-base font-semibold text-foreground">
          {issue.title}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">{issue.summary}</p>
      <span className="flex items-center gap-1 self-end text-sm font-semibold text-info-600">
        See details
        <ChevronRightIcon className="size-4" aria-hidden />
      </span>
    </Link>
  )
}

export default IssueCard
