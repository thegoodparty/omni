'use client'

import Link from 'next/link'
import { Button } from '@styleguide'
import { useContextualPlanPitch } from 'app/dashboard/shared/plan/usePlanPitch'
import { SEE_ALL_PLANS_LABEL } from 'app/dashboard/shared/plan/planPitch'
import type { GateChannel } from './gateCopy'
import { GateSurface } from './GateSurface'
import { ProPitchPanel } from './ProPitchPanel'

interface ProGateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: GateChannel
  title: string
  // "Join Pro for $299".
  ctaLabel: string
  onJoin: () => void
  // The host reports its own "See all plans" event before the link navigates.
  onSeeAllPlans?: () => void
}

// The Pro pitch the in-flow gate shows (win_per_campaign_pricing): the
// channel's four-row value card over a stacked "Join Pro for $299" and a
// ghost "See all plans". The explainer and the pitch the draft save opens
// both render it, so a candidate reads the same screen whichever door they
// came through. Flag-on only; the hosts keep their old screens flag off.
export const ProGateDialog = ({
  open,
  onOpenChange,
  channel,
  title,
  ctaLabel,
  onJoin,
  onSeeAllPlans,
}: ProGateDialogProps): React.JSX.Element => {
  const planPitch = useContextualPlanPitch()

  return (
    <GateSurface
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button size="large" className="w-full" onClick={onJoin}>
            {ctaLabel}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href={planPitch.allPlansHref} onClick={onSeeAllPlans}>
              {SEE_ALL_PLANS_LABEL}
            </Link>
          </Button>
        </>
      }
    >
      <ProPitchPanel channel={channel} />
    </GateSurface>
  )
}

export default ProGateDialog
