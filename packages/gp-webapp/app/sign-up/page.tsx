import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPostAuthRedirectPath } from 'app/dashboard/shared/candidateAccess'
import pageMetaData from 'helpers/metadataHelper'
import SignUpForm from './SignUpForm'
import MarketingPanel from './MarketingPanel'
import ClaimProfilePanel from './ClaimProfilePanel'
import {
  PROFILE_CLAIM_SIGNUP_SOURCE,
  isProfileClaimVariationOn,
} from './profileClaimVariation'

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

  // Decided before render so the panel never swaps after first paint. Only a
  // visitor from the profile claim link costs an Amplitude call.
  const { signup_source: signupSource } = await searchParams
  const showClaimPanel =
    signupSource === PROFILE_CLAIM_SIGNUP_SOURCE &&
    (await isProfileClaimVariationOn())

  return (
    <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2">
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
