'use client'

import { useState } from 'react'
import { Button, PlusIcon } from '@styleguide'
import Paper from '@shared/utils/Paper'
import DashboardLayout from '../../shared/DashboardLayout'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { useCampaign } from '@shared/hooks/useCampaign'
import { getContactsLabels } from '../../shared/contactsLabels'
import { ContactProModalProvider } from './ContactProModal'
import { ContactTypeahead } from './ContactTypeahead'
import PersonOverlay from './person/PersonOverlay'
import { useContactsTable } from './ContactsTableProvider'
import CreateListWizard from './wizard/CreateListWizard'
import DistrictStatCard from './DistrictStatCard'
import ListsIndex from './lists/ListsIndex'
import ListDetailSheet from './lists/ListDetailSheet'

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
  } = useContactsTable()
  const labels = getContactsLabels(isWinContext)

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

  return (
    <ContactProModalProvider value={setShowProModal}>
      <DashboardLayout>
        <Paper className="h-full">
          {/* Top bar: search + primary create action, right-aligned on desktop. */}
          <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
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

          {/* Hold ALL mode copy (heading, stat label, and the lists section's
              Voter/Constituent heading) until the Win/Serve context settles:
              isWinContext reads false until then, so rendering any of it
              early would flash the Serve noun to a Win user (ENG-10448) —
              ListsIndex reads contactsLabels too, so it needs the same gate
              the H1/stat card already had. */}
          {isWinContextReady && (
            <div className="mx-auto mt-8 flex w-full max-w-[560px] flex-col gap-8">
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
                />
              </div>

              <ListsIndex />
            </div>
          )}
        </Paper>
        <PersonOverlay />
        <CreateListWizard open={wizardOpen} onOpenChange={setWizardOpen} />
        <ListDetailSheet
          listId={currentlySelectedListId}
          onClose={() => selectList(null)}
        />
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
