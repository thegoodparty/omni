import { Alert, AlertDescription, Checkbox, Label } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { OutreachAudienceStep } from '../audience/OutreachAudienceStep'
import type { OutreachAudience } from '../audience/useOutreachAudience'
import { useEmailSender } from './emailApi'
import { formatCount, warmingCap } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailAudienceStepProps {
  surface: EmailSurface
  audience: OutreachAudience
  consent: boolean
  onConsentChange: (consent: boolean) => void
}

export const EmailAudienceStep = ({
  surface,
  audience,
  consent,
  onConsentChange,
}: EmailAudienceStepProps) => {
  const { data: sender } = useEmailSender(surface.isServe)
  const cap = sender ? warmingCap(sender.warmingStep) : null
  const reachable = audience.reachableLoading ? null : audience.reachableCount
  const picked = audience.mode === 'picker' && audience.selectedList !== null

  return (
    <div className="space-y-6">
      <OutreachAudienceStep
        channel="email"
        copy={surface.audience.picker}
        mode={audience.mode}
        lists={audience.lists}
        listsLoading={audience.listsLoading}
        selectedId={audience.selectedListId}
        onSelect={audience.onSelect}
        universeName={audience.universeName}
        universeListId={audience.universeListId}
        universeCount={audience.universeCount}
        universeNewContactsCount={audience.universeNewContactsCount}
        universeLoading={audience.universeLoading}
        onSelectUniverse={audience.selectUniverse}
        universePending={audience.universePending}
        universeError={audience.universeError}
        onPickerOpenChange={audience.onPickerOpenChange}
        onStartBuilder={audience.startBuilder}
        recommendations={audience.recommendations}
        recommendationsLoading={audience.recommendationsLoading}
        recommendationsError={audience.recommendationsError}
        recommendedListsChannel={audience.recommendedListsChannel}
        onCreateRecommendedList={async (recommendation, name) => {
          await audience.createRecommendedList(recommendation, name)
        }}
        onRecommendationReused={audience.trackRecommendationReused}
        selectedRecommendation={audience.selectedRecommendation}
        onSelectRecommendation={audience.selectRecommendation}
        reachableCount={audience.reachableCount}
        reachableNewContactsCount={audience.reachableNewContactsCount}
        reachableLoading={audience.reachableLoading}
        pricePerContact={0}
        builderFilters={audience.builderFilters}
        onBuilderFiltersChange={audience.setBuilderFilters}
        builderSupportStatus={audience.builderSupportStatus}
        builderPrecincts={audience.builderPrecincts}
        onBuilderPrecinctsChange={audience.setBuilderPrecincts}
        precinctOptions={audience.precinctOptions}
        onBuilderSupportStatusChange={audience.setBuilderSupportStatus}
        builderName={audience.builderName}
        onBuilderNameChange={audience.setBuilderName}
        isElectedOfficial={audience.isElectedOfficial}
        builderCount={audience.builderCount}
        builderCounting={audience.builderCounting}
        builderCapError={audience.builderCapError}
        builderCountErrorMessage={audience.builderCountErrorMessage}
      />

      {audience.createListError && audience.mode === 'name' && (
        <p className="text-sm text-destructive">
          We couldn&apos;t create this list. Try again.
        </p>
      )}

      {picked && reachable === 0 && (
        <Alert
          variant="info"
          icon={<CircleAlertIcon />}
          data-testid="email-audience-empty"
        >
          <AlertDescription>{surface.audience.noEmails}</AlertDescription>
        </Alert>
      )}

      {picked && reachable !== null && cap !== null && reachable > cap && (
        <div className="space-y-1" data-testid="email-audience-cap">
          <p className="text-sm text-muted-foreground">
            This send can reach up to {formatCount(cap)}{' '}
            {surface.recipientsNoun}. You can reach more on your next send.
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCount(cap)} of {formatCount(reachable)}
          </p>
        </div>
      )}

      {picked && reachable !== null && reachable > 0 && (
        <div className="flex items-start gap-3">
          <Checkbox
            id="email-consent"
            checked={consent}
            onCheckedChange={(value) => onConsentChange(value === true)}
            className="mt-0.5"
          />
          <Label htmlFor="email-consent" className="block text-sm font-normal">
            {surface.audience.consentLabel}
          </Label>
        </div>
      )}
    </div>
  )
}
