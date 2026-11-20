'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useBadgePlan } from 'app/dashboard/shared/plan/useBadgePlan'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { usePathname } from 'next/navigation'

const PlanLabel = ({ label }: { label: string }): React.JSX.Element => (
  <div
    className="
      pro-label
      font-semibold
      border
      border-gray-900
      rounded
      ml-2
      h-fit
      text-[10px]
      tracking-widest
      p-1
    "
  >
    {label}
  </div>
)

export const HeaderLogo = (): React.JSX.Element => {
  const badgePlan = useBadgePlan()
  const pathname = usePathname()

  return (
    <>
      <Link
        className="flex items-center no-underline"
        href="/dashboard"
        id="nav-logo"
        onClick={() =>
          trackEvent(EVENTS.Navigation.Top.ClickLogo, { pathname })
        }
      >
        <Image
          src="/images/logo/heart.svg"
          data-cy="logo"
          width={30}
          height={24}
          alt="GoodParty.org"
          priority
        />
        {badgePlan === 'pro' && <PlanLabel label="PRO" />}
        {badgePlan === 'team' && <PlanLabel label="TEAM" />}
      </Link>
    </>
  )
}
