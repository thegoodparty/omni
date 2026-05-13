'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ResponsiveModal from '../../shared/utils/ResponsiveModal'
import { Website, WebsiteTheme } from '../types/website.type'

interface SmsTermsModalProps {
  open: boolean
  content: Website['content']
  activeTheme: WebsiteTheme
}

export default function SmsTermsModal({
  open,
  content,
  activeTheme,
}: SmsTermsModalProps) {
  const campaignName = content?.main?.title || ''
  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const onClose = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('sms-terms')
    const query = params.toString()

    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="SMS Terms & Conditions"
      theme={{
        bg: activeTheme.bg,
        text: activeTheme.text,
        border: activeTheme.border,
      }}
    >
      <div className="mb-4">
        <h3 className="font-semibold text-lg mb-2">{campaignName}</h3>
        <p className="text-sm mb-4">Last Updated: {currentDate}</p>
      </div>
      <div className="space-y-4 text-sm">
        <div>
          <h3 className="font-medium">Program Description</h3>
          <p>
            By opting in, you agree to receive SMS messages from the{' '}
            {campaignName} campaign. Messages may include campaign updates,
            volunteer opportunities, event notifications, fundraising
            requests, and other campaign-related communications.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Message Frequency</h3>
          <p>
            Message frequency varies based on campaign activity. You will
            receive recurring messages from us.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Message and Data Rates</h3>
          <p>
            Message and data rates may apply. Check with your mobile carrier
            for details.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Opt-Out Instructions</h3>
          <p>
            You can opt out at any time by replying STOP to any message. After
            you send STOP, we will send a confirmation reply and you will no
            longer receive SMS messages from us.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Help Instructions</h3>
          <p>
            For help, reply HELP to any message or contact us using the
            information below.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Carrier Disclaimer</h3>
          <p>
            Carriers are not liable for delayed or undelivered messages.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Privacy</h3>
          <p>
            Your information is handled in accordance with our{' '}
            <Link
              href="?privacy=true"
              scroll={false}
              className="underline hover:opacity-80"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div>
          <h3 className="font-medium">Contact</h3>
          {content?.contact?.email && (
            <p>Email: {content.contact.email}</p>
          )}
          {content?.contact?.phone && <p>Phone: {content.contact.phone}</p>}
          {content?.contact?.address && (
            <p>Address: {content.contact.address}</p>
          )}
        </div>
      </div>
    </ResponsiveModal>
  )
}
