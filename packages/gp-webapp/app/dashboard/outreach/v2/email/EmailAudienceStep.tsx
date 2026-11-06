import {
  EMAIL_AUDIENCE_COUNTS_MAX_LISTS,
  EMAIL_MIN_CHARGE_CENTS,
  PRICE_PER_EMAIL_TENTH_CENTS,
} from '@goodparty_org/contracts'
import { useState } from 'react'
import { Alert, AlertDescription } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { OutreachAudienceStep } from '../audience/OutreachAudienceStep'
import type { OutreachAudience } from '../audience/useOutreachAudience'
import { useEmailAudienceCounts, useEmailSender } from './emailApi'
import { formatCount, formatDollars } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailAudienceStepProps {
  surface: EmailSurface
  audience: OutreachAudience
  // Everyone with an email address, the audience while no list is picked.
  everyone: { count: number | null; loading: boolean }
  everyoneDefault: boolean
}

export const EmailAudienceStep = ({
  surface,
  audience,
  everyone,
  everyoneDefault,
}: EmailAudienceStepProps) => {
  const { data: sender } = useEmailSender(surface.isServe)
  // Counted once the picker opens, so a step left untouched reads no list.
  const [pickerOpened, setPickerOpened] = useState(false)
  const listIds = audience.lists
    .filter((list) => list.id !== audience.universeListId)
    .slice(0, EMAIL_AUDIENCE_COUNTS_MAX_LISTS)
    .map((list) => list.id)
  const { data: listCountsData } = useEmailAudienceCounts(
    surface.isServe,
    { everyone: false, listIds },
    pickerOpened && listIds.length > 0,
  )
  const listCounts = new Map(
    (listCountsData?.lists ?? []).map((list) => [list.id, list.count]),
  )
  // The cap gp-api will freeze at confirm: the warming step's, less what
  // the sender's other unfinished sends reserved.
  const cap = sender ? sender.availableCap : null
  const reachable = everyoneDefault
    ? everyone.loading
      ? null
      : everyone.count
    : audience.reachableLoading
      ? null
      : audience.reachableCount
  const picked =
    audience.mode === 'picker' &&
    (everyoneDefault || audience.selectedList !== null)
  // Priced the way gp-api prices the send: the capped count at a cent each,
  // never under the minimum. It is the most it can cost, since only emails
  // that go out are charged.
  const billable =
    reachable !== null && cap !== null ? Math.min(reachable, cap) : reachable
  const priceCents =
    billable !== null && billable > 0
      ? Math.max(
          EMAIL_MIN_CHARGE_CENTS,
          Math.ceil((billable * PRICE_PER_EMAIL_TENTH_CENTS) / 10),
        )
      : null

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
        universeCount={everyone.count}
        universeLoading={everyone.loading}
        onSelectUniverse={audience.selectUniverse}
        universePending={audience.universePending}
        universeError={audience.universeError}
        universeDefault={everyoneDefault}
        listCounts={listCounts}
        onPickerOpenChange={(open) => {
          if (open) setPickerOpened(true)
          audience.onPickerOpenChange(open)
        }}
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

      {everyoneDefault && audience.universeError && (
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
          <AlertDescription>
            {everyoneDefault
              ? surface.audience.noEmailsEveryone
              : surface.audience.noEmails}
          </AlertDescription>
        </Alert>
      )}

      {picked && priceCents !== null && (
        <div className="space-y-1" data-testid="email-audience-price">
          <p className="text-sm text-foreground">
            Up to {formatDollars(priceCents)}
          </p>
          <p className="text-sm text-muted-foreground">
            {surface.audience.picker.unitCostLabel}{' '}
            {formatDollars(PRICE_PER_EMAIL_TENTH_CENTS / 10)}
          </p>
        </div>
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
    </div>
  )
}
