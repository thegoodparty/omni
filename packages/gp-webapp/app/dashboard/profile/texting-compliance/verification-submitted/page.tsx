import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import VerificationSubmittedContent from './components/VerificationSubmittedContent'

const meta = pageMetaData({
  title: 'Verification submitted | GoodParty.org',
  description: 'Your campaign has been submitted for verification.',
})
export const metadata = meta

// The design's verification "pending" screen (voter outreach 2.0): the
// election-filing form used to bounce straight to /dashboard/account with
// only a snackbar, leaving no confirmation of what was submitted or when
// the PIN arrives. Statically rendered: the filing submit that lands here
// is the only entry, so no compliance-state read is needed.
export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  return (
    <div className="min-h-screen bg-white pt-2 md:pt-4">
      <div className="mx-auto w-full max-w-2xl p-4">
        <VerificationSubmittedContent />
      </div>
    </div>
  )
}
