'use client'

import Modal from '@shared/utils/Modal'
import H1 from '@shared/typography/H1'
import Body2 from '@shared/typography/Body2'
import { Button } from '@styleguide'
import Link from 'next/link'
import { FREE_TEXTS_OFFER } from '../outreach/constants'
import { EVENTS, trackEvent, buildTrackingAttrs } from 'helpers/analyticsHelper'
import { useEffect } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { usePlanPitch } from 'app/dashboard/shared/plan/usePlanPitch'
import { SeeAllPlansLink } from 'app/dashboard/shared/plan/SeeAllPlansLink'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  proUpgradeHref,
  type ProUpgradeSource,
} from 'app/dashboard/pro-upgrade/proUpgradeAttribution'

export const VIABILITY_SCORE_THRESHOLD = 2

export type VariantType =
  | 'First'
  | 'Second_NonViable'
  | 'Second_Viable'
  | 'Third'

export const VARIANTS: { [K in VariantType]: K } = {
  First: 'First',
  Second_NonViable: 'Second_NonViable',
  Second_Viable: 'Second_Viable',
  Third: 'Third',
}

interface ProUpgradeModalProps {
  open: boolean
  variant: VariantType
  onClose?: () => void
  onUpgradeLinkClick?: () => void
  defaultTrackingEnabled?: boolean
  trackingAttrs?: ReturnType<typeof buildTrackingAttrs>
  // Which surface opened the modal, for the wizard's Flow Started event.
  source?: ProUpgradeSource
}

export function ProUpgradeModal({
  open,
  variant,
  onClose,
  onUpgradeLinkClick,
  defaultTrackingEnabled = false,
  trackingAttrs = {},
  source = 'direct',
}: ProUpgradeModalProps): React.JSX.Element {
  const [user] = useUser()
  const [campaign] = useCampaign()
  const sessionCount = user?.metaData?.sessionCount || 0
  const vendorP2v = campaign?.vendorTsData?.['pathToVictory'] as
    | { viability?: { score?: number } }
    | undefined
  const viablityScore = vendorP2v?.viability?.score || 0
  const { smsCompliance } = useSmsCompliance()
  const smsClosed = smsCompliance === 'closed'
  const planPitch = usePlanPitch()
  const planName = planPitch.enabled ? planPitch.name : 'Pro'

  let title: string,
    description: string,
    items: React.ReactNode[],
    highlight: string | null,
    cta: string

  switch (variant) {
    case VARIANTS.First:
      title = `Upgrade to GoodParty.org ${planName}`
      description =
        'Instant access to voter data and tools to connect with your community:'
      items = [
        <>
          Create targeted <span className="font-bold">voter lists</span>
        </>,
        smsClosed ? (
          <>
            Send <span className="font-bold">voicemails</span> (pay-as-you-go)
          </>
        ) : (
          <>
            Send <span className="font-bold">texts and voicemails</span>{' '}
            (pay-as-you-go)
          </>
        ),
        <>
          Secure votes with powerful{' '}
          <span className="font-bold">canvassing tools</span>
        </>,
      ]
      highlight = planPitch.enabled
        ? `Start today for ${planPitch.price}.`
        : 'Start today for just $10/month.'
      cta = 'Upgrade now'
      break
    case VARIANTS.Second_NonViable:
      title = `Get ${planName} voter data and tools`
      description = `Join GoodParty.org ${planName} today to get:`
      items = [
        <>
          <span className="font-bold">Unlimited voter files</span> tailored to
          your community
        </>,
        <>
          <span className="font-bold">Custom voter segmentation</span> for
          targeting
        </>,
        smsClosed ? (
          <>
            <span className="font-bold">Voice and door-knocking</span> tools for
            outreach
          </>
        ) : (
          <>
            <span className="font-bold">Text, voice and door-knocking</span>{' '}
            tools for outreach
          </>
        ),
      ]
      highlight = null
      cta = planPitch.enabled
        ? `Upgrade for ${planPitch.price}`
        : 'Upgrade for $10/month'
      break
    case VARIANTS.Second_Viable:
      title = `Boost your campaign with ${planName}`
      description = `Join GoodParty.org ${planName} today to get:`
      items = [
        smsClosed ? (
          <>
            <span className="font-bold">Voice and door-knocking</span> tools for
            outreach
          </>
        ) : planPitch.enabled ? (
          <>
            <span className="font-bold">{planPitch.credit}</span> in outreach
            credit
          </>
        ) : (
          <>
            {FREE_TEXTS_OFFER.COUNT.toLocaleString()}{' '}
            <span className="font-bold">free text messages</span>
          </>
        ),
        <>One-on-one access to political analysts</>,
      ]
      highlight = planPitch.enabled
        ? `Start today for ${planPitch.price}.`
        : smsClosed
          ? 'Start today for just $10/month.'
          : 'Upgrade today to claim your free benefits.'
      cta = planPitch.enabled
        ? `Upgrade for ${planPitch.price}`
        : 'Upgrade for $10/month'
      break
    case VARIANTS.Third:
    default:
      title = `Win with GoodParty.org ${planName}!`
      description = `Winning candidates used ${planName} tools to:`
      items = [
        <>
          <span className="font-bold">Target</span>&nbsp;the right voters
        </>,
        <>
          <span className="font-bold">Mobilize</span>&nbsp;their supporters
        </>,
        <>
          <span className="font-bold">Get voters</span>&nbsp;to participate in
          early voting
        </>,
      ]
      highlight = planPitch.enabled
        ? `Join them today for ${planPitch.price}.`
        : 'Join them today for just $10/month.'
      cta = 'Upgrade now'
      break
  }

  useEffect(() => {
    if (open) {
      trackEvent(EVENTS.ProUpgrade.Modal.Shown, {
        sessionCount,
        viablityScore,
        variant,
        path: window.location.pathname,
      })
    }
  }, [open])

  const handleClose = (): void => {
    if (defaultTrackingEnabled) {
      trackEvent(EVENTS.ProUpgrade.Modal.Exit, {
        sessionCount,
        viablityScore,
        variant,
        path: window.location.pathname,
      })
    }
    if (onClose) {
      onClose()
    }
  }

  const handleUpgradeLinkClick = (): void => {
    if (defaultTrackingEnabled) {
      trackEvent(EVENTS.ProUpgrade.Modal.ClickButton, {
        sessionCount,
        viablityScore,
        variant,
        path: window.location.pathname,
      })
    }

    if (onUpgradeLinkClick) {
      onUpgradeLinkClick()
    } else if (onClose) {
      onClose()
    }
  }

  // Leaving for the plans page must dismiss the auto-popup the same way the
  // primary CTA does, or it reopens over the plans page.
  const handleSeeAllPlansClick = (): void => {
    if (onUpgradeLinkClick) {
      onUpgradeLinkClick()
    } else if (onClose) {
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      closeCallback={handleClose}
      preventBackdropClose
      preventEscClose
    >
      <div className="p-0 sm:p-2 md:p-8">
        <H1 className="m-0 sm:whitespace-nowrap">{title}</H1>
        <Body2 className="my-4">{description}</Body2>
        <Body2 className="leading-4">
          <ul className="list-none list-inside p-0 m-0">
            {items.map((item, index) => (
              // The item rides in one span: globals.css turns li into a flex
              // container under any data-slot ancestor (the v2 outreach hub
              // mounts this modal inside one), and a flex li swallows the
              // leading space of a text node that follows an element — the
              // bold-phrase items rendered as "filestailored" there.
              <li key={index}>
                ✔&nbsp; <span>{item}</span>
              </li>
            ))}
          </ul>
        </Body2>
        {highlight && (
          <Body2 className="mt-4 text-blue !font-bold">{highlight}</Body2>
        )}
        <Button
          asChild
          size="large"
          className="mt-8"
          onClick={handleUpgradeLinkClick}
          {...trackingAttrs}
        >
          <Link href={proUpgradeHref({ source, channel: 'generic', cta })}>
            {cta}
          </Link>
        </Button>
        {planPitch.enabled && (
          <div className="mt-4">
            <SeeAllPlansLink
              href={planPitch.allPlansHref}
              onClick={handleSeeAllPlansClick}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
