'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProBadge,
} from '@styleguide'
import {
  DoorOpenIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PRO_UPGRADE_ENTRY_PATH } from 'app/shared/experiments/proUpgrade3Flag'
import { MEMBERSHIP_COPY } from './membershipCopy'

const TILE_ICONS = [UsersIcon, MessageSquareIcon, DoorOpenIcon, ShieldCheckIcon]

const TILE_TINTS = [
  'bg-primary-light',
  'bg-secondary-light',
  'bg-success-light',
  'bg-warning-light',
]

interface ProPitchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The membership surface's Pro pitch (design: renderProPitch): what Pro costs
// and the four things it unlocks. Closing it is the X, so the only button is
// the one that joins.
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

  // Every other way out of the dialog — the X, escape, the overlay — is a
  // dismissal, and there is no dismiss button left to report it.
  const handleOpenChange = (next: boolean) => {
    if (!next) trackEvent(EVENTS.ProUpgrade.Membership.PitchDismiss)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader className="items-center text-center">
          <ProBadge size="large" />
          <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
            {MEMBERSHIP_COPY.pitch.title}
          </DialogTitle>
          <span className="inline-flex h-8 items-center rounded-full bg-info-light/45 px-3.5 text-[15px] font-medium text-primary">
            {MEMBERSHIP_COPY.pitch.pill}
          </span>
        </DialogHeader>
        <div className="grid gap-5 rounded-xl border border-info-light p-5 sm:grid-cols-2 sm:gap-6 sm:p-6">
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
          <Button
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleJoin}
          >
            {MEMBERSHIP_COPY.pitch.join}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
