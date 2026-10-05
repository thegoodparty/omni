// No 'use client' of its own: the turf sheet that mounts it is already
// inside a client boundary.
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, cn } from '@styleguide'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { whatWeHeardCopy } from './copy'
import { pendingQueryOptions } from './[outreachId]/queries'

interface NotesToReviewLinkProps {
  // The effort's Outreach envelope; null renders nothing.
  outreachId: number | null
  isServe: boolean
  // The review page to open. The manager's by default; a volunteer has one
  // of their own under `/volunteer`.
  href?: string
  className?: string
}

// The way from an effort to its unconfirmed notes, shown only while some
// wait: memos recorded with no signal, and any whose extraction failed.
export const NotesToReviewLink = ({
  outreachId,
  isServe,
  href,
  className,
}: NotesToReviewLinkProps) => {
  const copy = whatWeHeardCopy(isServe)
  // Not the treatment surface (the capture card is), so no exposure.
  const { enabled } = useIssueCaptureFlag(false)
  const { data } = useQuery({
    ...pendingQueryOptions(outreachId ?? 0),
    enabled: enabled && outreachId !== null,
    // A count does not need the review list's polling.
    refetchInterval: false,
  })

  if (!enabled || outreachId === null || !data || data.length === 0) {
    return null
  }

  return (
    <Link
      href={href ?? `/dashboard/issue-capture/${outreachId}/review`}
      className={cn(
        'flex items-center justify-between gap-3 text-sm font-medium text-foreground no-underline',
        className,
      )}
    >
      {copy.notesToReview(data.length)}
      <ChevronRightIcon size={16} aria-hidden="true" />
    </Link>
  )
}
