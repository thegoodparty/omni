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

export const CrmContactsPage = () => {
  const [campaign] = useCampaign()
  const [showProModal, setShowProModal] = useState(false)
  const { isWinContext, isWinContextReady } = useContactsTable()
  const labels = getContactsLabels(isWinContext)

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
            {/* Visible no-op per the locked design: the Voter Lists table
                (CRM feature 4) wires this up. */}
            <Button className="shrink-0 self-start md:self-auto">
              Create new list
            </Button>
          </div>
        </Paper>
        <PersonOverlay />
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
