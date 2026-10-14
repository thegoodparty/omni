import Link from 'next/link'
import { Button } from '@styleguide'
import { SmsCutoffNotice } from 'app/dashboard/shared/smsCutoff/SmsCutoffNotice'
import { SMS_CUTOFF_COPY } from '../verificationCopy'

interface SmsCutoffPageProps {
  surface: string
}

// The info screen a texting compliance route renders in place of its form
// once gp-api reports the SMS compliance window closed. The page decides that
// on the server; this only draws it.
const SmsCutoffPage = ({ surface }: SmsCutoffPageProps): React.JSX.Element => (
  <div className="min-h-screen bg-white px-6 py-10">
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <SmsCutoffNotice variant="screen" surface={surface} />
      <Button asChild size="large" variant="outline">
        <Link href="/dashboard">{SMS_CUTOFF_COPY.backToDashboard}</Link>
      </Button>
    </div>
  </div>
)

export default SmsCutoffPage
