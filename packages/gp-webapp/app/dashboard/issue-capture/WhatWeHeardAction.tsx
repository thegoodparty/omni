// No 'use client' of its own: the outreach drawer that mounts it is already
// inside a client boundary.
import Link from 'next/link'
import { Button, MessageSquareIcon } from '@styleguide'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { whatWeHeardCopy } from './copy'

// The outreach drawer's way into an effort's report, at any status: a
// finished effort is exactly the one whose summary has run. A button in the
// drawer's sticky footer, beside the campaign's own action, because it is
// somewhere to go next rather than something to read in the body. The drawer
// mounts it only once the effort has a note, from the report's counts, so it
// can drop the slot and keep the footer whole.
export const WhatWeHeardAction = ({
  outreachId,
  isServe,
  className,
  onNavigate,
}: {
  outreachId: number
  isServe: boolean
  // How it shares its row: grows beside the CTA, fills a grid cell.
  className?: string
  // Closes the drawer first, so the report does not render beneath it.
  onNavigate?: () => void
}) => {
  const copy = whatWeHeardCopy(isServe)
  // Not the treatment surface (the capture card is), so no exposure.
  const { enabled } = useIssueCaptureFlag(false)
  if (!enabled) return null

  return (
    <Button asChild variant="outline" className={className}>
      <Link
        href={`/dashboard/issue-capture/${outreachId}`}
        onClick={onNavigate}
      >
        <MessageSquareIcon className="size-4" aria-hidden="true" />
        {copy.title}
      </Link>
    </Button>
  )
}
