'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '../../shared/DashboardLayout'
import { CandidatePositionsProvider } from 'app/dashboard/campaign-details/components/issues/CandidatePositionsProvider'
import H1 from '@shared/typography/H1'
import Body2 from '@shared/typography/Body2'
import { Button } from '@styleguide'
import Link from 'next/link'
import { ProPricingCard } from 'app/dashboard/upgrade-to-pro/components/ProPricingCard'
import {
  PRO_UPGRADE_ENTRY_PATH,
  useProUpgrade3Flag,
} from '@shared/experiments/proUpgrade3Flag'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { usePageExit } from '@shared/hooks/usePageExit'
import { Campaign, CandidatePosition } from 'helpers/types'

interface PricingCardConfig {
  title: string
  features: string[]
  price: string
  sub: string
  primaryCard?: boolean
}

interface UpdateToProPageProps {
  pathname?: string
  campaign: Campaign | null
  candidatePositions?: CandidatePosition[]
}

const CARD_DIY: PricingCardConfig = {
  title: 'DIY @ Election Board',
  features: [
    'Confusing, unstructured data',
    'Outdated systems',
    'Bureaucratic processes',
    'Little to no support',
  ],
  price: 'Free',
  sub: 'Cumbersome experience',
}

const CARD_PRO: PricingCardConfig = {
  title: 'GoodParty.org',
  features: [
    'Comprehensive data tailored to your community',
    'Easy voter segmentation for targeted outreach',
    'AI campaign assistant',
    'Candidate community',
    'Free campaign resources',
  ],
  price: '$10/month',
  sub: 'Unlimited Records',
  primaryCard: true,
}

const CARD_COMPETITORS: PricingCardConfig = {
  title: 'Our Competitors',
  features: [
    'Expensive and low quality data sets',
    'Difficult voter segmentation',
    'Lack of actionable insights',
    'Inefficient workflows',
    'Partisan leaning',
  ],
  price: '$200+',
  sub: 'Based on 10,000 records',
}

export default function DetailsPage(
  props: UpdateToProPageProps,
): React.JSX.Element | null {
  const router = useRouter()
  const { ready, enabled } = useProUpgrade3Flag()

  usePageExit(() => {
    // Only the off-cohort actually views this splash. The cohort is bounced to
    // the new wizard (below), and the flag-resolution re-render consumes
    // usePageExit's initial-mount guard, so without this condition the bounce
    // unmount would emit a spurious SplashPage.Exit for a page they never saw.
    if (ready && !enabled) trackEvent(EVENTS.ProUpgrade.SplashPage.Exit)
  })

  // This legacy splash is the off-cohort funnel. The pro-upgrade3 cohort can
  // still land here via server-side redirects (voter-records, texting
  // compliance) and the dashboard menu that can't read the client flag, so
  // bounce them into the new wizard rather than the old pro-sign-up flow.
  useEffect(() => {
    if (ready && enabled) router.replace(PRO_UPGRADE_ENTRY_PATH)
  }, [ready, enabled, router])

  const handleJoinProOnClick = (): void => {
    trackEvent(EVENTS.ProUpgrade.SplashPage.ClickUpgrade)
  }

  // Cohort users are being redirected; don't flash the legacy splash content.
  if (ready && enabled) return null

  return (
    <DashboardLayout {...props}>
      <CandidatePositionsProvider candidatePositions={props.candidatePositions}>
        <div className="mx-auto bg-white rounded-xl p-4 md:px-16 md:py-12">
          <H1 className="text-center mb-2">Why pay more for less?</H1>
          <Body2 className="text-center mb-8">
            GoodParty.org Pro has everything you need to improve your outreach
            for a fraction of the price:
          </Body2>

          <div className="mt-8 mb-12 grid grid-cols-1 md:grid-cols-3 gap-4">
            <ProPricingCard {...CARD_DIY} />
            <ProPricingCard {...CARD_PRO} />
            <ProPricingCard {...CARD_COMPETITORS} />
          </div>

          <Button
            asChild
            size="large"
            onClick={handleJoinProOnClick}
            className="!block md:w-[300px] mx-auto mt-12"
          >
            <Link href="/dashboard/pro-sign-up">
              Start today for just $10/month.
            </Link>
          </Button>
        </div>
      </CandidatePositionsProvider>
    </DashboardLayout>
  )
}
