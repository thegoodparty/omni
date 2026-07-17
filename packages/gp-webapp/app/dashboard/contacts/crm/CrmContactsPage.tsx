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
import ListsTable from './lists/ListsTable'

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
          {/* Hold the mode copy until the Win/Serve context settles:
              isWinContext reads false until then, so rendering early would
              flash the Serve noun to a Win user (ENG-10448). */}
          {isWinContextReady && (
            <h1 className="text-3xl font-semibold">{labels.universeTitle}</h1>
          )}
          <div className="mt-6 flex w-full flex-col gap-4 md:flex-row md:items-center">
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
          <ListsTable />
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
