import pageMetaData from 'helpers/metadataHelper'
import MarketingPanel from '../MarketingPanel'
import SignUpPhoneForm from './SignUpPhoneForm'

const meta = pageMetaData({
  title: 'Add your phone number',
  description: 'Add your phone number to GoodParty.org.',
  slug: '/sign-up/phone',
})
export const metadata = meta

/**
 * The last step of the Google sign-up: the OAuth handshake can't carry a
 * phone number, so `sso-callback` forwards new accounts here to collect it
 * before `/post-auth-redirect` submits the HubSpot registration form. Not
 * gated server-side on `auth()` — the client form bounces a signed-out
 * visitor, and a hard redirect here would race Clerk's session hand-off.
 */
export default function SignUpPhonePage() {
  return (
    <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2">
      {/* Unlike /sign-up, this form is far shorter than the marketing panel,
          so the panel is what stretches the grid row past the viewport. A
          plain items-center would then centre the form against that taller
          row and leave it sitting low on screen — pin the column to the
          viewport instead and let the panel scroll behind it. */}
      <div className="flex items-center justify-center bg-white px-6 py-12 lg:sticky lg:top-16 lg:order-2 lg:h-[calc(100vh-64px)] lg:py-16">
        <SignUpPhoneForm />
      </div>
      <MarketingPanel className="lg:order-1" />
    </div>
  )
}
