'use client'
import Paper from '@shared/utils/Paper'
import DashboardLayout from '../../../shared/DashboardLayout'
import ContactsTable from './ContactsTable'
import PersonOverlay from './person/PersonOverlay'
import Download from './Download'
import SegmentSection from './segments/SegmentSection'
import ContactsStatsSection from './ContactsStatsSection'
import { ContactSearch } from './ContactSearch'
import { ContactProModalProvider } from '../hooks/ContactProModal'
import { useEffect, useState } from 'react'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { useContactsTable } from '../hooks/ContactsTableProvider'
import { useCampaign } from '@shared/hooks/useCampaign'
import H2 from '@shared/typography/H2'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export default function ContactsPage() {
  const [campaign] = useCampaign()
  const [showProModal, setShowProModal] = useState(false)
  const {
    isCustomSegment,
    searchTerm,
    totalSegmentContacts,
    isVoterDataUnavailable,
    isWinContext,
    isWinContextReady,
  } = useContactsTable()

  // isWinContext reads false until both the elected-office query and the
  // win-voter-data flag settle, so firing before then would emit a spurious
  // serve event followed by a win one on every Win page load. Wait for
  // isWinContextReady so we fire one Contacts Viewed with the right context.
  useEffect(() => {
    if (!isWinContextReady) return
    trackEvent(EVENTS.Contacts.Viewed, {
      context: isWinContext ? 'win' : 'serve',
    })
  }, [isWinContextReady, isWinContext])
  return (
    <ContactProModalProvider value={setShowProModal}>
      <DashboardLayout>
        <Paper className="h-full">
          <div className="flex flex-col">
            <h1 className="text-3xl font-semibold">Constituents</h1>
            <p className="text-lg font-normal text-muted-foreground">
              Manage and filter on your constituent list
            </p>
          </div>

          {isVoterDataUnavailable ? (
            <div className="mt-6">
              <H2>Voter data not available for your district</H2>
              <Body2 className="mt-2 text-muted-foreground">
                We don&apos;t have voter data for this office yet. Please
                contact support at help@goodparty.org so we can update your
                district information.
              </Body2>
            </div>
          ) : (
            <>
              <div className="w-full mt-6 flex items-center space-between">
                <div className="flex flex-col md:flex-row flex-1 items-center gap-2 mr-4">
                  <SegmentSection />
                  <Download />
                </div>
                <div className="align-right hidden md:flex md:w-full xl:w-[400px]">
                  <ContactSearch />
                </div>
              </div>

              <div className="mt-6">
                <ContactsStatsSection
                  totalVisibleContacts={totalSegmentContacts}
                  onlyTotalVisibleContacts={isCustomSegment || !!searchTerm}
                />
              </div>

              <div className="flex align-right md:hidden sm:w-full">
                <ContactSearch />
              </div>
              <div className="relative mt-6 lg:mt-0">
                <ContactsTable />
              </div>
            </>
          )}
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
