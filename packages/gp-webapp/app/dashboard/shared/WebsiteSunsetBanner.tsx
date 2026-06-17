import { buttonVariants } from '@styleguide/components/ui/button'
import { HUBSPOT_DOMAIN_TRANSFER_FORM_URL } from './websiteSunset'

interface WebsiteSunsetBannerProps {
  eligible: boolean
}

// Persistent (non-dismissible) counterpart to WebsiteSunsetModal. The modal
// shows once on the dashboard; this banner gives candidates a permanent path
// back to the domain-transfer form from Settings (ENG-10304). Same eligibility
// as the modal — see isWebsiteSunsetEligible: a candidate who purchased a
// domain while the notice is enabled.
export function WebsiteSunsetBanner({
  eligible,
}: WebsiteSunsetBannerProps): React.JSX.Element | null {
  if (!eligible) {
    return null
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-3 rounded-lg border border-neutral-400 bg-card px-4 py-3 text-card-foreground"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          Our build your own website feature is being discontinued
        </p>
        <p className="text-sm">
          Please transfer your domain to a provider of your choice.
        </p>
      </div>
      <a
        href={HUBSPOT_DOMAIN_TRANSFER_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'small' })}
      >
        Transfer
      </a>
    </div>
  )
}
