'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, MailIcon } from '@styleguide/components/ui/icons'
import { FetchError } from 'ofetch'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

interface SharePlanModalProps {
  open: boolean
  onClose: () => void
  candidateName: string
  // Generates (or returns the cached) public PDF link. Owned by the parent
  // so the blob render + upload can be reused and cached across opens.
  getShareUrl: () => Promise<string>
}

type ShareState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string }

const SHARE_ERROR_FALLBACK =
  "We couldn't create your share link. Please try again."

const toShareErrorMessage = (e: unknown): string =>
  (e instanceof FetchError && extractApiErrorInfo(e.data).message) ||
  SHARE_ERROR_FALLBACK

interface ShareBodyProps {
  state: ShareState
  copied: boolean
  onCopy: () => void
  onEmail: () => void
  onRetry: () => void
}

const ShareBody = ({
  state,
  copied,
  onCopy,
  onEmail,
  onRetry,
}: ShareBodyProps): React.JSX.Element => {
  if (state.status === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-sm">{state.message}</p>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={onRetry}
        >
          Try again
        </Button>
      </div>
    )
  }

  const isLoading = state.status === 'loading'

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        icon={
          copied ? (
            <CheckIcon className="size-5" />
          ) : (
            <CopyIcon className="size-5" />
          )
        }
        disabled={isLoading}
        onClick={onCopy}
      >
        {isLoading
          ? 'Preparing your link…'
          : copied
            ? 'Link copied'
            : 'Copy link'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        icon={<MailIcon className="size-5" />}
        disabled={isLoading}
        onClick={onEmail}
      >
        Email
      </Button>
    </div>
  )
}

const SharePlanModal = ({
  open,
  onClose,
  candidateName,
  getShareUrl,
}: SharePlanModalProps): React.JSX.Element => {
  const isMobile = useIsMobile()
  const [state, setState] = useState<ShareState>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resolveShareUrl = async () => {
    setState({ status: 'loading' })
    try {
      const url = await getShareUrl()
      setState({ status: 'ready', url })
    } catch (e) {
      setState({ status: 'error', message: toShareErrorMessage(e) })
    }
  }

  useEffect(() => {
    if (!open) {
      setCopied(false)
      return
    }
    if (state.status === 'ready') return
    void resolveShareUrl()
  }, [open])

  const subject = candidateName
    ? `${candidateName}'s campaign plan`
    : 'My campaign plan'
  const message = candidateName
    ? `${candidateName} just built a campaign plan with GoodParty.org. Take a look:`
    : 'I just built a campaign plan with GoodParty.org. Take a look:'

  const handleCopy = async () => {
    if (state.status !== 'ready') return
    try {
      await navigator.clipboard.writeText(state.url)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      setCopied(true)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; do nothing.
    }
  }

  const handleEmail = () => {
    if (state.status !== 'ready') return
    const emailHref = `mailto:?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(message)}%0D%0A%0D%0A${encodeURIComponent(
      state.url,
    )}`
    window.open(emailHref, '_blank', 'noopener,noreferrer')
  }

  const body = (
    <ShareBody
      state={state}
      copied={copied}
      onCopy={() => void handleCopy()}
      onEmail={handleEmail}
      onRetry={() => void resolveShareUrl()}
    />
  )

  const title = 'Share your campaign plan'
  const description =
    'Send your plan to a teammate, family member, or supporter.'

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 p-4">{body}</div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

export default SharePlanModal
