import { useState } from 'react'
import { civicPanelJoinPath } from '@goodparty_org/contracts'
import { Button, cn } from '@styleguide'
import { APP_SHARE_BASE } from 'appEnv'
import { MANAGED_PANEL_COPY } from '../managedPanelCopy'

const COPY = MANAGED_PANEL_COPY.joinLink

// The office's public join page, served from this app's origin. The code
// names no person.
export const managedPanelJoinUrl = (shareCode: string): string =>
  `${APP_SHARE_BASE}${civicPanelJoinPath(shareCode)}`

// The join link with a copy button, on the panel page and in the Chief of
// Staff chat.
export const ManagedPanelJoinLink = ({
  shareCode,
  className,
}: {
  shareCode: string
  className?: string
}) => {
  const [copied, setCopied] = useState(false)
  const url = managedPanelJoinUrl(shareCode)
  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-testid="managed-panel-join-link"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {COPY.title}
        </span>
        <span className="text-sm leading-6 text-muted-foreground">
          {COPY.caption}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="medium"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
          }}
        >
          {copied ? COPY.copied : COPY.copy}
        </Button>
      </div>
    </div>
  )
}
