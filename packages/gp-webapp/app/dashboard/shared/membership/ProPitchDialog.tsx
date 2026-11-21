'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProBadge,
} from '@styleguide'
import { Alert, AlertTitle } from '@styleguide/components/ui/alert'
import {
  DoorOpenIcon,
  GiftIcon,
  InfoIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UsersIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { TEAM_SETTINGS_PATH } from 'app/dashboard/pro-upgrade/proUpgradePlanParams'
import {
  proUpgradeHref,
  type ProUpgradeChannel,
  type ProUpgradeSource,
} from 'app/dashboard/pro-upgrade/proUpgradeAttribution'
import { buildPlanPitch } from '../plan/planPitch'
import { usePlanPitch } from '../plan/usePlanPitch'
import { SEE_ALL_PLANS_LABEL } from '../plan/planPitch'
import { usePlan } from './deriveMembershipState'
import {
  MEMBERSHIP_COPY,
  PLAN_PITCH_ROWS,
  membershipInviteCopy,
  membershipPlanCopy,
} from './membershipCopy'

const TILE_ICONS = [UsersIcon, MessageSquareIcon, DoorOpenIcon, ShieldCheckIcon]

// The design's `TINT` washes are brand-palette steps (midnight-100, then the
// 200 of lavender, halo green and waxflower), not the theme's `-light` roles.
const TILE_TINTS = [
  'bg-brand-midnight-100',
  'bg-brand-lavender-200',
  'bg-brand-halo-green-200',
  'bg-brand-waxflower-200',
]

const PLAN_ROW_ICONS = {
  team: UsersRoundIcon,
  voterData: UsersIcon,
  outreach: MessageSquareIcon,
  doors: DoorOpenIcon,
  verification: ShieldCheckIcon,
} as const

const PLAN_ROW_TINTS = {
  team: TILE_TINTS[0],
  voterData: TILE_TINTS[0],
  outreach: TILE_TINTS[1],
  doors: TILE_TINTS[2],
  verification: TILE_TINTS[3],
} as const

interface ProPitchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Which wall opened the pitch, for its events and the wizard's Flow Started.
  source: ProUpgradeSource
  channel: ProUpgradeChannel
  // Invite on a gated campaign: always the Team pitch, titled for inviting,
  // and checkout returns to the team page.
  invite?: boolean
}

// The membership surface's Pro pitch (design: renderProPitch): what Pro costs
// and the four things it unlocks. Closing it is the X, so the only button is
// the one that joins.
export const ProPitchDialog = ({
  open,
  onOpenChange,
  source,
  channel,
  invite = false,
}: ProPitchDialogProps): React.JSX.Element => {
  const router = useRouter()
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  const smsClosed = smsCompliance === 'closed'
  const flagPitch = usePlanPitch()
  const { plan } = usePlan()
  const planPitch = invite
    ? buildPlanPitch(flagPitch.ready, flagPitch.enabled, true)
    : flagPitch
  const copy = invite
    ? membershipInviteCopy(plan === 'pro')
    : planPitch.enabled
      ? membershipPlanCopy(planPitch)
      : {
          pitchTitle: MEMBERSHIP_COPY.pitch.title,
          pitchPill: MEMBERSHIP_COPY.pitch.pill,
          pitchJoin: MEMBERSHIP_COPY.pitch.join,
        }
  // Verification only exists to unlock texting, so once texting has closed
  // for the race the tile sells nothing Pro can still deliver.
  const tiles = MEMBERSHIP_COPY.pitch.tiles
    .map((tile, index) => ({
      ...tile,
      Icon: TILE_ICONS[index]!,
      tint: TILE_TINTS[index],
    }))
    .filter(({ title }) => !smsClosed || title !== 'Campaign verification')

  const planRows = (
    [
      ...(planPitch.plan === 'team' ? (['team'] as const) : []),
      'voterData',
      'outreach',
      'doors',
      'verification',
    ] as const
  ).filter((key) => !smsClosed || key !== 'verification')
  // The price leads the pill in bold: "$399, one payment for ...".
  const [, pillPrice = '', pillRest = copy.pitchPill] =
    /^(\$\d+(?:\.\d{2})?)(.*)$/.exec(copy.pitchPill) ?? []

  useEffect(() => {
    if (open) {
      trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialViewed, {
        channel,
        plan,
      })
    }
  }, [open, channel, plan])

  const handleJoin = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialCompleted, {
      channel,
      plan,
    })
    onOpenChange(false)
    router.push(
      proUpgradeHref(
        {
          source,
          channel,
          cta:
            planPitch.enabled && !invite
              ? `Join ${planPitch.name}`
              : copy.pitchJoin,
        },
        invite ? { plan: 'team', returnTo: TEAM_SETTINGS_PATH } : undefined,
      ),
    )
  }

  // Every other way out of the dialog — the X, escape, the overlay — is a
  // dismissal, and there is no dismiss button left to report it.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      trackEvent(EVENTS.ProUpgrade.Compliance.InterstitialDismissed, {
        channel,
      })
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* DialogContent's own `sm:max-w-lg` would cap the 640px the design
          draws, so the width is set at the same breakpoint. */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-5 rounded-2xl p-5 sm:max-w-[640px] sm:gap-6 sm:p-8">
        {/* Only the body scrolls, so a short viewport never carries the Join
            button off the bottom of the dialog. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto sm:gap-6">
          {/* DialogHeader's own classes end in `sm:text-left`, so centering
              the wrapped lines needs the sm: breakpoint spelled out too. */}
          <DialogHeader className="items-center gap-3 text-center sm:text-center">
            {planPitch.enabled && planPitch.plan === 'team' ? (
              <Badge>TEAM</Badge>
            ) : (
              <ProBadge size="large" className="h-[30px] w-[66px]" />
            )}
            <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
              {copy.pitchTitle}
            </DialogTitle>
            <span className="rounded-xl bg-info-50 px-3.5 py-1.5 text-center text-[15px] font-medium text-primary sm:rounded-full">
              {planPitch.enabled ? (
                <>
                  <strong className="font-semibold">{pillPrice}</strong>
                  {pillRest}
                </>
              ) : (
                copy.pitchPill
              )}
            </span>
          </DialogHeader>
          {smsClosed && (
            <Alert variant="info" icon={<InfoIcon />}>
              <AlertTitle>
                {SMS_CUTOFF_COPY.closedReason(
                  smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null,
                )}
              </AlertTitle>
            </Alert>
          )}
          {planPitch.enabled ? (
            <ul className="flex flex-col divide-y divide-brand-blue-200 rounded-xl border border-brand-blue-200">
              {planRows.map((key) => {
                const Icon = PLAN_ROW_ICONS[key]
                const { title, body } = PLAN_PITCH_ROWS[key]
                return (
                  <li key={key} className="flex items-center gap-3 p-4">
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full ${PLAN_ROW_TINTS[key]}`}
                    >
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{title}</span>
                      <span className="text-sm text-base-muted-foreground">
                        {body}
                      </span>
                    </span>
                    {key === 'outreach' && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium">
                        <GiftIcon className="size-4" aria-hidden />
                        {planPitch.credit} credit
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="grid gap-5 rounded-xl border border-brand-blue-200 p-5 sm:grid-cols-2 sm:gap-6 sm:p-6">
              {tiles.map(({ title, body, Icon, tint }) => (
                <div key={title} className="flex flex-col gap-2">
                  <span
                    className={`flex size-10 items-center justify-center rounded-full ${tint}`}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-base-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-col items-center sm:flex-col sm:justify-center">
          <Button
            size={planPitch.enabled ? 'large' : undefined}
            className={
              planPitch.enabled ? 'w-full' : 'w-full sm:w-auto sm:min-w-[360px]'
            }
            onClick={handleJoin}
          >
            {copy.pitchJoin}
          </Button>
          {planPitch.enabled && (
            <Button variant="ghost" asChild className="w-full">
              <Link
                href={planPitch.allPlansHref}
                onClick={() => onOpenChange(false)}
              >
                {SEE_ALL_PLANS_LABEL}
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
