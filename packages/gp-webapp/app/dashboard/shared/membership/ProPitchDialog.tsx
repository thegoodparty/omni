'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProBadge,
} from '@styleguide'
import {
  ChartColumnIcon,
  DoorOpenIcon,
  MessageSquareIcon,
  Share2Icon,
  ShieldCheckIcon,
  UsersIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PRO_UPGRADE_ENTRY_PATH } from 'app/shared/experiments/proUpgrade3Flag'
import { MEMBERSHIP_COPY } from './membershipCopy'

const TILE_ICONS = [
  UsersIcon,
  MessageSquareIcon,
  DoorOpenIcon,
  Share2Icon,
  ShieldCheckIcon,
  ChartColumnIcon,
]

const TILE_TINTS = [
  'bg-primary-light',
  'bg-info-light',
  'bg-success-light',
  'bg-secondary-light',
  'bg-warning-light',
  'bg-tertiary-light',
]

interface ProPitchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ProPitchDialog = ({
  open,
  onOpenChange,
}: ProPitchDialogProps): React.JSX.Element => {
  const router = useRouter()

  useEffect(() => {
    if (open) trackEvent(EVENTS.ProUpgrade.Membership.PitchViewed)
  }, [open])

  const handleJoin = () => {
    trackEvent(EVENTS.ProUpgrade.Membership.PitchJoin)
    onOpenChange(false)
    router.push(PRO_UPGRADE_ENTRY_PATH)
  }

  const handleDismiss = () => {
    trackEvent(EVENTS.ProUpgrade.Membership.PitchDismiss)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader className="items-start text-left">
          <ProBadge size="large" />
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {MEMBERSHIP_COPY.pitch.title}
          </DialogTitle>
          <DialogDescription>{MEMBERSHIP_COPY.pitch.body}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MEMBERSHIP_COPY.pitch.tiles.map(({ title, body }, index) => {
            const Icon = TILE_ICONS[index]!
            return (
              <div key={title} className="flex flex-col gap-2">
                <span
                  className={`flex size-10 items-center justify-center rounded-full ${TILE_TINTS[index]}`}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-base-muted-foreground">{body}</p>
              </div>
            )
          })}
        </div>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={handleDismiss}>
            {MEMBERSHIP_COPY.pitch.dismiss}
          </Button>
          <Button onClick={handleJoin}>{MEMBERSHIP_COPY.pitch.join}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
