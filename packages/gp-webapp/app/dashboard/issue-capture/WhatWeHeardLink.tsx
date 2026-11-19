// No 'use client' of its own: every surface that mounts it (the turf row, the
// turf sheet, the phone caller) is already inside a client boundary.
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, MessageSquareIcon, cn } from '@styleguide'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { whatWeHeardCopy } from './copy'
import { reportQueryOptions } from './[outreachId]/queries'
import { safeReturnPath, withReturnPath } from './returnPath'

interface WhatWeHeardLinkProps {
  // The effort's Outreach envelope. Null where the surface has none, which
  // renders nothing rather than a link to a report that cannot exist.
  outreachId: number | null
  isServe: boolean
  className?: string
}

// The way into an effort's report from where the effort lives. It reads the
// report for its two counts and says nothing until there is something to
// read: the product's capture is off, or nobody has answered yet.
export const WhatWeHeardLink = ({
  outreachId,
  isServe,
  className,
}: WhatWeHeardLinkProps) => {
  const copy = whatWeHeardCopy(isServe)
  // The page it was pressed on, so the report's Back returns here.
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''
  const here = search ? `${pathname}?${search}` : pathname
  // Not the treatment surface (the capture card is), so no exposure.
  const { enabled } = useIssueCaptureFlag(false)
  const { data } = useQuery({
    ...reportQueryOptions(outreachId ?? 0),
    enabled: enabled && outreachId !== null,
    // Two counts do not need the report page's polling.
    refetchInterval: false,
  })

  if (!enabled || outreachId === null || !data) return null
  const { conversations, memos } = data.denominators
  if (conversations === 0 && memos === 0) return null

  return (
    <Link
      href={withReturnPath(
        `/dashboard/issue-capture/${outreachId}`,
        safeReturnPath(here),
      )}
      className={cn(
        'group flex items-center justify-between gap-3 text-sm no-underline',
        className,
      )}
    >
      {/* The title never wraps; on a narrow card the counts take the line
          break instead, right-aligned. */}
      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-medium text-foreground underline-offset-4 group-hover:underline">
        <MessageSquareIcon size={16} aria-hidden="true" />
        {copy.title}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1 text-right tabular-nums text-muted-foreground">
        {copy.entryCounts(data.denominators, data.channel)}
        <ChevronRightIcon size={16} aria-hidden="true" />
      </span>
    </Link>
  )
}
