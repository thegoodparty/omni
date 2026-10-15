import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import VerificationSubmittedContent from './components/VerificationSubmittedContent'

const meta = pageMetaData({
  title: 'Verification submitted | GoodParty.org',
  description: 'Your campaign has been submitted for verification.',
})
export const metadata = meta

// The design's verification "pending" screen (voter outreach 2.0): the
// election-filing form used to bounce straight to /dashboard/account with
// only a snackbar, leaving no confirmation of what was submitted or when
// the PIN arrives. The filing submit that lands here is the only entry, so
// the only state it reads is whether the SMS compliance window has closed,
// in which case no PIN is coming.
export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const campaign = await fetchUserCampaign()

  return (
    <div className="min-h-screen bg-white pt-2 md:pt-4">
      <div className="mx-auto w-full max-w-2xl p-4">
        <VerificationSubmittedContent
          smsClosed={campaign?.smsCompliance === 'closed'}
        />
      </div>
    </div>
  )
}
