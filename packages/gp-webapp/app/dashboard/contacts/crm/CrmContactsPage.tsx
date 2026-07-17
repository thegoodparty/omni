'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
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

export const CrmContactsPage = () => {
  const [campaign] = useCampaign()
  const [showProModal, setShowProModal] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const { isWinContext, isWinContextReady, canUseProFeatures } =
    useContactsTable()
  const labels = getContactsLabels(isWinContext)

  const handleCreateList = () => {
    if (!canUseProFeatures) {
      setShowProModal(true)
      return
    }
    setWizardOpen(true)
  }

  return (
    <ContactProModalProvider value={setShowProModal}>
      <DashboardLayout>
        <Paper className="h-full">
          {/* Top bar: search + primary create action, right-aligned on desktop. */}
          <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:max-w-[400px]">
              <ContactTypeahead />
            </div>
            <Button
              className="shrink-0 self-start md:self-auto"
              onClick={handleCreateList}
            >
              Create new list
            </Button>
          </div>

          {/* Hold ALL mode copy (heading, stat label, and the lists section's
              Voter/Constituent heading) until the Win/Serve context settles:
              isWinContext reads false until then, so rendering any of it
              early would flash the Serve noun to a Win user (ENG-10448) —
              ListsIndex reads contactsLabels too, so it needs the same gate
              the H1/stat card already had. No district-name subtitle here
              (ticket's "if district info is available" clause): ContactsStats
              only carries an opaque districtId, no human-readable district
              name is available anywhere in the frontend today, so there is
              nothing presentable to show. */}
          {isWinContextReady && (
            <>
              <div className="mx-auto mt-8 flex w-full max-w-3xl flex-col items-center gap-4 text-center">
                <h1 className="text-3xl font-semibold">
                  {labels.universeTitle}
                </h1>
                <DistrictStatCard label={labels.districtTotalLabel} />
              </div>

              <div className="mx-auto mt-8 w-full max-w-5xl">
                <ListsIndex />
              </div>
            </>
          )}
        </Paper>
        <PersonOverlay />
        <CreateListWizard open={wizardOpen} onOpenChange={setWizardOpen} />
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
