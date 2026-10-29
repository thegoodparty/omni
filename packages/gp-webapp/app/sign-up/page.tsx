import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cn } from '@styleguide'
import { getPostAuthRedirectPath } from 'app/dashboard/shared/candidateAccess'
import pageMetaData from 'helpers/metadataHelper'
import SignUpForm from './SignUpForm'
import MarketingPanel from './MarketingPanel'
import ClaimProfilePanel from './ClaimProfilePanel'
import { PROFILE_CLAIM_SIGNUP_SOURCE } from './profileClaimSource'

const meta = pageMetaData({
  title: 'Sign up to GoodParty.org',
  description: 'Sign up to GoodParty.org.',
  slug: '/sign-up',
})
export const metadata = meta

export default async function SignUpPage({
  searchParams,
}: PageProps<'/sign-up'>) {
  const { userId } = await auth()
  if (userId) {
    redirect(await getPostAuthRedirectPath())
  }

  const { signup_source: signupSource } = await searchParams
  const showClaimPanel = signupSource === PROFILE_CLAIM_SIGNUP_SOURCE

  return (
    <div
      className={cn(
        'grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2',
        // Figma gives the claim panel 820 of 1440px; below xl that would
        // squeeze the form, so it keeps the even split there.
        showClaimPanel && 'xl:grid-cols-[41fr_31fr]',
      )}
    >
      <div className="flex items-center justify-center bg-white px-6 py-12 lg:order-2 lg:py-16">
        <SignUpForm />
      </div>
      {showClaimPanel ? (
        <ClaimProfilePanel className="lg:order-1" />
      ) : (
        <MarketingPanel className="lg:order-1" />
      )}
    </div>
  )
}
