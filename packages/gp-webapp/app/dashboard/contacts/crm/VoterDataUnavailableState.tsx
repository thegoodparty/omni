import { Button, Card, MapPinIcon } from '@styleguide'
import { getContactsLabels } from '../../shared/contactsLabels'

const SUPPORT_EMAIL = 'help@goodparty.org'

interface VoterDataUnavailableStateProps {
  officeName: string | null
  isWinContext: boolean
  // Included in the support email so the team can find the org without a
  // round trip. Absent on the legacy page, which has no org in scope.
  organizationSlug?: string
}

const VoterDataUnavailableState = ({
  officeName,
  isWinContext,
  organizationSlug,
}: VoterDataUnavailableStateProps) => {
  const labels = getContactsLabels(isWinContext)

  const subject = officeName
    ? `Voter data setup request: ${officeName}`
    : 'Voter data setup request'
  const body = [
    'My contacts page says voter data is not available for my office.',
    officeName ? `Office: ${officeName}` : null,
    organizationSlug ? `Organization: ${organizationSlug}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`

  return (
    <Card className="w-full items-center gap-3 rounded-2xl p-8 text-center">
      <MapPinIcon className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">{labels.unavailableTitle}</h2>
      <p className="max-w-[420px] text-sm text-muted-foreground">
        {officeName
          ? labels.unavailableBodyWithOffice(officeName)
          : labels.unavailableBody}
      </p>
      <Button asChild className="mt-2">
        <a href={href}>Contact support</a>
      </Button>
      <p className="text-xs text-muted-foreground">
        Typical setup time: 1-2 business days
      </p>
    </Card>
  )
}

export default VoterDataUnavailableState
