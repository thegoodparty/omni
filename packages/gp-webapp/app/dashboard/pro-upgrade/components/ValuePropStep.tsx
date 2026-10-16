'use client'

import { useEffect } from 'react'
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
  DoorOpenIcon,
  FolderHeartIcon,
  GiftIcon,
  HandHeartIcon,
  MegaphoneIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { useProUpgradeWizard } from './ProUpgradeWizard'

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

// The same comparison once texting has closed for the race: the 10DLC and free
// texts rows, and the $300 value they add up to, are gone.
const COMPARISON_ROWS_SMS_CLOSED: ComparisonRow[] = [
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
    label: 'Robocalls and phone banking',
    free: false,
    icon: MegaphoneIcon,
    description:
      'Reach your voters at scale with robocalls, and talk to them one by one with phone banking.',
  },
  {
    label: 'Door knocking',
    free: false,
    icon: DoorOpenIcon,
    description:
      'Get routes, addresses and voter details so you or your volunteers can meet voters face to face.',
  },
]

const ROW_GRID =
  'grid grid-cols-[1fr_64px_64px] md:grid-cols-[1fr_100px_100px] items-center'

const ValuePropStep = (): React.JSX.Element => {
  const { goToNextStep, exit } = useProUpgradeWizard()
  const { smsCompliance } = useSmsCompliance()
  const smsClosed = smsCompliance === 'closed'
  const rows = smsClosed ? COMPARISON_ROWS_SMS_CLOSED : COMPARISON_ROWS

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropViewed)
  }, [])

  const handleGetPro = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropGetPro)
    goToNextStep()
  }

  const handleMaybeLater = () => {
    trackEvent(EVENTS.ProUpgrade.Compliance.ValuePropMaybeLater)
    exit()
  }

  return (
    <div>
      <h1
        className={`text-center text-[32px] leading-[44px] font-semibold ${smsClosed ? 'mb-6' : 'mb-1.5'}`}
      >
        76% of candidates who use Pro win
      </h1>
      {!smsClosed && (
        <Body2 className="text-center text-base-muted-foreground mb-6">
          Get $300 of value for $10/mo.
        </Body2>
      )}

      <div className="mb-9">
        <div className={`${ROW_GRID} py-2`}>
          <span />
          <span className="text-center">Free</span>
          <span className="flex justify-center">
            <ProBadge size="large" />
          </span>
        </div>

        {rows.map(({ label, free, icon: Icon, description }) => (
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
    </div>
  )
}

export default ValuePropStep
