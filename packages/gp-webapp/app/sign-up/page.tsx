import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPostAuthRedirectPath } from 'app/dashboard/shared/candidateAccess'
import pageMetaData from 'helpers/metadataHelper'
import SignUpForm from './SignUpForm'
import MarketingPanel from './MarketingPanel'

const meta = pageMetaData({
  title: 'Sign up to GoodParty.org',
  description: 'Sign up to GoodParty.org.',
  slug: '/sign-up',
})
export const metadata = meta

export default async function SignUpPage() {
  const { userId } = await auth()
  if (userId) {
    redirect(await getPostAuthRedirectPath())
  }

  return (
    <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center bg-white px-6 py-12 lg:order-2 lg:py-16">
        <SignUpForm />
      </div>
      <MarketingPanel className="lg:order-1" />
    </div>
  )
}
