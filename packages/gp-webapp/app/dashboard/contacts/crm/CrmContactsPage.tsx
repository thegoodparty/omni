'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, PlusIcon } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import DashboardLayout from '../../shared/DashboardLayout'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useOrganization } from '@shared/organization-picker'
import {
  getContactsLabels,
  WIN_UNIVERSE_STAT_LABELS,
} from '../../shared/contactsLabels'
import { ContactProModalProvider } from './ContactProModal'
import { ContactTypeahead } from './ContactTypeahead'
import PersonOverlay from './person/PersonOverlay'
import { useContactsTable } from './ContactsTableProvider'
import CreateListWizard from './wizard/CreateListWizard'
import DistrictStatCard from './DistrictStatCard'
import ListsIndex from './lists/ListsIndex'
import ListDetailSheet from './lists/ListDetailSheet'
import CrmAssistant from './assistant/CrmAssistant'
import VoterDataUnavailableState from './VoterDataUnavailableState'

export const CrmContactsPage = () => {
  const [campaign] = useCampaign()
  const [showProModal, setShowProModal] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const {
    isWinContext,
    isWinContextReady,
    canUseProFeatures,
    currentlySelectedListId,
    selectList,
    voterDataUnavailable,
  } = useContactsTable()
  const organization = useOrganization()
  const labels = getContactsLabels(isWinContext)

  // ENG-10767: same event the pre-CRM ContactsPage fires (parity — flag-on
  // users vanished from the Contacts Viewed chart), distinguished by
  // surface: 'crm' (absent = legacy page). Same ready-gate + ref latch as
  // that page: isWinContext reads false until the elected-office query
  // settles, and a later toggle must not re-fire.
  const hasFiredViewedRef = useRef(false)
  useEffect(() => {
    if (!isWinContextReady || hasFiredViewedRef.current) return
    hasFiredViewedRef.current = true
    trackEvent(EVENTS.Contacts.Viewed, {
      context: isWinContext ? 'win' : 'serve',
      surface: 'crm',
    })
  }, [isWinContextReady, isWinContext])

  // Same ready-gate and latch as the Viewed event above: isWinContext reads
  // false until the elected-office query settles, so firing early would label a
  // Win user as Serve.
  const hasFiredUnavailableRef = useRef(false)
  useEffect(() => {
    if (!isWinContextReady || !voterDataUnavailable) return
    if (hasFiredUnavailableRef.current) return
    hasFiredUnavailableRef.current = true
    trackEvent(EVENTS.Contacts.VoterDataUnavailable, {
      context: isWinContext ? 'win' : 'serve',
    })
  }, [isWinContextReady, isWinContext, voterDataUnavailable])

  const handleCreateList = () => {
    if (!canUseProFeatures) {
      setShowProModal(true)
      return
    }
    setWizardOpen(true)
  }

  // The Lovable design names the place ("Find voters in Austin, District 9
  // …"); campaign.details is the only frontend source for it, and Serve orgs
  // have no campaign, so both modes fall back to "your district".
  const details = campaign?.details
  const districtLocation =
    [details?.city, details?.district].filter(Boolean).join(', ') ||
    'your district'

  // ENG-10746: the Win universe card carries the raceTargetMetrics trio.
  // Null metrics (no P2V yet) fall back to the voters row alone, and a
  // zero-valued metric is dropped rather than rendered as "0".
  const raceTargetMetrics = campaign?.raceTargetMetrics
  const universeMetricRows =
    isWinContext && raceTargetMetrics
      ? [
          {
            label: WIN_UNIVERSE_STAT_LABELS.projectedTurnout,
            value: raceTargetMetrics.projectedTurnout,
          },
          {
            label: WIN_UNIVERSE_STAT_LABELS.votersNeededToWin,
            value: raceTargetMetrics.winNumber,
          },
        ].filter((row) => row.value > 0)
      : undefined

  return (
    <ContactProModalProvider value={setShowProModal}>
      <DashboardLayout
        // The header title is mode copy, so it rides the same
        // isWinContextReady gate as the rest of the page (ENG-10448).
        navHeader={
          isWinContextReady
            ? { icon: 'users', label: labels.dataTitle }
            : undefined
        }
      >
        {/* Top bar: search + primary create action on its own full-bleed
            white bar (negative margins cancel the layout wrapper's padding)
            so the content below floats on the gray canvas (ENG-10747). */}
        {!voterDataUnavailable && (
          <div className="-mx-2 -mt-2 flex flex-col gap-4 border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="w-full md:w-[420px]">
              <ContactTypeahead />
            </div>
            <Button
              className="shrink-0 self-start text-sm font-semibold md:self-auto"
              disabled={!isWinContextReady}
              onClick={handleCreateList}
              icon={<PlusIcon />}
            >
              Create new list
            </Button>
          </div>
        )}

        {/* Hold ALL mode copy (heading, stat label, and the lists section's
            Voter/Constituent heading) until the Win/Serve context settles:
            isWinContext reads false until then, so rendering any of it
            early would flash the Serve noun to a Win user (ENG-10448) —
            ListsIndex reads contactsLabels too, so it needs the same gate
            the H1/stat card already had. */}
        {isWinContextReady && (
          // pb-24 clears the fixed assistant bar so the last list card
          // scrolls fully above it.
          <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-8 pb-24">
            {voterDataUnavailable ? (
              // Unmounting rather than disabling: DistrictStatCard and
              // ListsIndex's AllContactsCard share the ['contacts-stats'] key,
              // and React Query fires a query when ANY mounted observer is
              // enabled, so disabling one of them would still spend the request.
              <VoterDataUnavailableState
                officeName={organization?.positionName ?? null}
                isWinContext={isWinContext}
                organizationSlug={organization?.slug}
              />
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <h1 className="text-lg font-semibold">
                    {labels.universeTitle}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {labels.universeSubtitleBefore}
                    <span className="font-semibold text-foreground">
                      {districtLocation}
                    </span>
                    {labels.universeSubtitleAfter}
                  </p>
                  <DistrictStatCard
                    className="mt-4"
                    label={labels.districtTotalLabel}
                    additionalRows={universeMetricRows}
                  />
                </div>

                <ListsIndex />
              </>
            )}
          </div>
        )}
        {/* Both sheets open purely off the URL, and a district-gated query reports
            pending/idle — so isLoading (isPending && isFetching) and isError are
            both false and neither guard branch fires. Left mounted, a deep link
            drops a dataless sheet straight over the empty state. The assistant's
            CRM tools hit the same gated services. */}
        {!voterDataUnavailable && (
          <>
            <PersonOverlay />
            <CreateListWizard open={wizardOpen} onOpenChange={setWizardOpen} />
            <ListDetailSheet
              listId={currentlySelectedListId}
              onClose={() => selectList(null)}
            />
            <CrmAssistant />
          </>
        )}
      </DashboardLayout>
      {campaign && (
        <ProUpgradeModal
          variant={VARIANTS.Second_NonViable}
          open={showProModal}
          onClose={() => setShowProModal(false)}
          onUpgradeLinkClick={() => setShowProModal(false)}
          defaultTrackingEnabled
        />
      )}
    </ContactProModalProvider>
  )
}
