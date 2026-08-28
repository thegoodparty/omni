'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  ProBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@styleguide'
import {
  BadgeCheckIcon,
  CalendarDaysIcon,
  CheckIcon,
  FolderHeartIcon,
  GiftIcon,
  HandHeartIcon,
  MegaphoneIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  PRO_UPGRADE_BASE_PATH,
  PRO_UPGRADE_TAKEOVER_SRC,
} from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'
import { useTakeoverActive } from 'app/dashboard/shared/takeover/TakeoverShell'
import WizardStepFooter from './WizardStepFooter'
import WizardHeading from './WizardHeading'
import {
  GATHER_ROWS,
  IconRowList,
  PRO_GATE_COPY,
  ProLockBadge,
  ProValueList,
  UpgradeVerifySteps,
  WhyWeAskAlert,
} from './takeoverProContent'

interface ComparisonRow {
  label: string
  free: boolean
  icon: React.ComponentType<{ className?: string }>
  description: string
}
// Free-vs-Pro comparison from the Figma. Every row is included in Pro, so only
// the Free column varies.
const COMPARISON_ROWS: ComparisonRow[] = [
  {
    label: 'Campaign plan',
    free: true,
    icon: CalendarDaysIcon,
    description:
      'Get a personalized, data-driven campaign plan that maps out exactly how many voters you need to reach.',
  },
  {
    label: 'Dedicated campaign expert',
    free: false,
    icon: HandHeartIcon,
    description:
      'Get personalized advising from a dedicated campaign expert assigned to you through election day.',
  },
  {
    label: 'Voter data & list building',
    free: false,
    icon: FolderHeartIcon,
    description:
      'Get the high-quality voter data big-party candidates take for granted, so you can connect with the right people.',
  },
  {
    label: '10DLC compliance',
    free: false,
    icon: BadgeCheckIcon,
    description:
      'Texting voters requires 10DLC carrier registration. We take care of the whole process so your texts are not flagged as spam. ($140 value)',
  },
  {
    label: 'Texts and robocalls',
    free: false,
    icon: MegaphoneIcon,
    description:
      'Reach your voters at scale. Run text and robocall campaigns at the lowest cost possible.',
  },
  {
    label: 'Up to 5,000 free texts',
    free: false,
    icon: GiftIcon,
    description:
      'Send up to 5,000 free text messages on your first campaign! ($175 value)',
  },
]

const ROW_GRID =
  'grid grid-cols-[1fr_64px_64px] md:grid-cols-[1fr_100px_100px] items-center'

const ValuePropStep = (): React.JSX.Element => {
  const takeover = useTakeoverActive()
  const router = useRouter()
  const { goToNextStep } = useProUpgradeWizard()
  // The channel the gated tile was clicked on (?channel=sms|phone-banking|…).
  // Design channels get the design's pause screen + gather overview here;
  // anything else keeps the generic Free-vs-Pro pitch below as the fallback.
  const channel = useSearchParams()?.get('channel') ?? null
  const gateCopy = channel ? PRO_GATE_COPY[channel] : undefined
  const [gateScreen, setGateScreen] = useState<'pause' | 'overview'>('pause')

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropViewed)
  }, [])

  const handleGetPro = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropGetPro)
    goToNextStep()
  }

  const handleMaybeLater = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropMaybeLater)
    router.push('/dashboard')
  }

  // The gather overview's Continue re-enters the wizard index WITHOUT the
  // channel param: the index forced this pitch open for a gated-channel
  // arrival regardless of progress, so resuming has to go back through its
  // derivation instead of blindly stepping to `status` (which a returning
  // candidate may have already answered).
  const handleGateContinue = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropGetPro)
    router.push(`${PRO_UPGRADE_BASE_PATH}?src=${PRO_UPGRADE_TAKEOVER_SRC}`)
  }

  if (takeover && gateCopy) {
    if (gateScreen === 'pause') {
      // Design PRO_COPY pause screen (channel-specific pitch): badge + lock,
      // headline/subhead, the Upgrade-then-Verify mini progress, PRO_CARDS.
      return (
        <div className="flex flex-col items-center gap-5 pt-4 text-center">
          <ProLockBadge />
          <div className="flex max-w-[460px] flex-col gap-2">
            <h1 className="text-2xl font-semibold">{gateCopy.headline}</h1>
            <p className="text-base text-muted-foreground">
              {gateCopy.subhead}
            </p>
          </div>
          <UpgradeVerifySteps />
          <div className="w-full">
            <ProValueList />
          </div>
          <WizardStepFooter
            primary={{
              label: gateCopy.cta,
              onClick: () => setGateScreen('overview'),
            }}
            back={{ label: 'Maybe later', onClick: handleMaybeLater }}
          />
        </div>
      )
    }
    // Design sgBody 'overview': what to have ready before the upgrade.
    return (
      <div>
        <WizardHeading
          proBadge
          title="Let's gather a few things to unlock Pro"
          subtitle="Have this information available to verify your campaign"
        />
        <IconRowList rows={GATHER_ROWS} />
        <p className="mt-5 text-sm text-muted-foreground">
          Ready when you are.
        </p>
        <WhyWeAskAlert>
          Carriers require these details before a campaign can send text
          messages.
        </WhyWeAskAlert>
        <WizardStepFooter
          primary={{ label: 'Continue', onClick: handleGateContinue }}
          back={{ onClick: () => setGateScreen('pause') }}
        />
      </div>
    )
  }

  return (
    <div>
      <WizardHeading
        center
        title="76% of candidates who use Pro win"
        subtitle="Get $300 of value for $10/mo."
      />

      <div className="mb-9">
        <div className={`${ROW_GRID} py-2`}>
          <span />
          <span className="text-center">Free</span>
          <span className="flex justify-center">
            <ProBadge size="large" />
          </span>
        </div>

        {COMPARISON_ROWS.map(({ label, free, icon: Icon, description }) => (
          <div
            key={label}
            className={`${ROW_GRID} border-b last:border-b-0 border-base-border py-3`}
          >
            {/* disableHoverableContent + sideOffset keep a gap the pointer
                can't cross, so the tooltip never sticks open over the row
                underneath it (per the design note). */}
            <Tooltip openOnClick disableHoverableContent>
              <TooltipTrigger className="justify-self-start cursor-pointer text-left underline decoration-dotted">
                {label}
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                sideOffset={8}
                showArrow={false}
                className="flex w-[428px] max-w-[calc(100vw-2rem)] items-start gap-4 rounded-xl bg-card p-4 text-left text-card-foreground shadow-md"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-bright-yellow-200">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="flex flex-col gap-2">
                  <span className="text-xl font-semibold leading-7">
                    {label}
                  </span>
                  <span className="text-base font-normal leading-6">
                    {description}
                  </span>
                </span>
              </TooltipContent>
            </Tooltip>
            <span className="flex justify-center">
              {free ? (
                <CheckIcon className="h-4 w-4 text-primary" />
              ) : (
                <XMarkIcon className="h-4 w-4 text-destructive" />
              )}
            </span>
            <span className="flex justify-center">
              <CheckIcon className="h-4 w-4 text-primary" />
            </span>
          </div>
        ))}
      </div>

      {takeover ? (
        <WizardStepFooter
          primary={{ label: 'Get Pro for $10/mo', onClick: handleGetPro }}
          back={{ label: 'Maybe later', onClick: handleMaybeLater }}
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Button
            size="large"
            className="w-full sm:w-auto"
            onClick={handleGetPro}
          >
            Get Pro for $10/mo
          </Button>
          <Button variant="ghost" onClick={handleMaybeLater}>
            Maybe later
          </Button>
        </div>
      )}
    </div>
  )
}

export default ValuePropStep
