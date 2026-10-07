// No 'use client' of its own: the outreach drawer that mounts it is already
// inside a client boundary.
import Link from 'next/link'
import { ChevronRightIcon, MessageSquareIcon } from '@styleguide'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { whatWeHeardCopy } from './copy'

// The outreach drawer's way into an effort's report, at any status: a
// finished effort is exactly the one whose summary has run. Unlike
// `WhatWeHeardLink` it reads no counts, so opening a drawer costs no
// report request; the page itself says when there is nothing yet.
export const WhatWeHeardAction = ({
  outreachId,
  isServe,
}: {
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  // Not the treatment surface (the capture card is), so no exposure.
  const { enabled } = useIssueCaptureFlag(false)
  if (!enabled) return null

  return (
    <Link
      href={`/issue-capture/${outreachId}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 no-underline"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageSquareIcon size={16} aria-hidden="true" />
          {copy.title}
        </span>
        <span className="text-sm text-muted-foreground">
          {copy.drawerCaption}
        </span>
      </span>
      <ChevronRightIcon
        size={16}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
    </Link>
  )
}
