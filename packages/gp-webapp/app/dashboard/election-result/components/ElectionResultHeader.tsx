import { IconButton } from '@styleguide/components/ui/icon-button'
import { GoodPartyOrgLogoWordmark } from '@styleguide/components/ui/good-party-org-logo-wordmark'
import { XMarkIcon } from '@styleguide/components/ui/icons'

interface ElectionResultHeaderProps {
  onClose?: () => void
}

// min-h-16 keeps the bar the same height whether or not the close button is in it.
export const ElectionResultHeader = ({
  onClose,
}: ElectionResultHeaderProps): React.JSX.Element => (
  <header className="flex min-h-16 items-center justify-between border-b border-base-border bg-background px-4 py-3 md:px-6">
    <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
    {onClose && (
      <IconButton
        type="button"
        variant="ghost"
        size="medium"
        aria-label="Close"
        onClick={onClose}
      >
        <XMarkIcon className="size-5" aria-hidden />
      </IconButton>
    )}
  </header>
)
