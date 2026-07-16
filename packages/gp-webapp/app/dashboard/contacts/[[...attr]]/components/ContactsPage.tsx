'use client'
import Paper from '@shared/utils/Paper'
import DashboardLayout from '../../../shared/DashboardLayout'
import ContactsTable from './ContactsTable'
import PersonOverlay from './person/PersonOverlay'
import Download from './Download'
import SegmentSection from './segments/SegmentSection'
import ContactsStatsSection from './ContactsStatsSection'
import { ContactSearch } from './ContactSearch'
import { ContactTypeahead } from './ContactTypeahead'
import { ContactProModalProvider } from '../hooks/ContactProModal'
import { useEffect, useRef, useState } from 'react'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { useContactsTable } from '../hooks/ContactsTableProvider'
import { useCampaign } from '@shared/hooks/useCampaign'
import H2 from '@shared/typography/H2'
import Body2 from '@shared/typography/Body2'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'

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
  const labels = getContactsLabels(isWinContext)

  // The typeahead is the CRM rollout's treatment surface, so exposure fires
  // here (trackExposure: true). `enabled` already folds in `ready`, so both
  // flag-off and not-yet-settled render today's table search — the flag-off
  // experience is byte-identical to before this gate existed.
  const { enabled: isCrmTypeaheadEnabled } = useCrmEnabled(true)
  const searchControl = isCrmTypeaheadEnabled ? (
    <ContactTypeahead />
  ) : (
    <ContactSearch />
  )

  // isWinContext reads false until both the elected-office query and the
  // win-voter-data flag settle, so firing before then would emit a spurious
  // serve event followed by a win one on every Win page load. Wait for
  // isWinContextReady, and latch with a ref so a later isWinContext toggle
  // (flag re-fetch on identity change, useElectedOffice focus revalidation)
  // can't re-fire — one Contacts Viewed per mount with the settled context.
  const hasFiredViewedRef = useRef(false)
  useEffect(() => {
    if (!isWinContextReady || hasFiredViewedRef.current) return
    hasFiredViewedRef.current = true
    trackEvent(EVENTS.Contacts.Viewed, {
      context: isWinContext ? 'win' : 'serve',
    })
  }, [isWinContextReady, isWinContext])
  return (
    <ContactProModalProvider value={setShowProModal}>
      <DashboardLayout
        navHeader={
          isWinContextReady && !isWinContext
            ? { icon: 'users', label: labels.dataTitle }
            : undefined
        }
      >
        <Paper className="h-full">
          {/* Wait for the Win/Serve context to settle before naming anything:
              isWinContext reads false until the elected-office query and the
              win-voter-data flag resolve, so rendering early would flash the
              Serve copy ("constituent") to a Win user (ENG-10448). */}
          {isWinContextReady && (
            <div className="flex flex-col">
              {/* Serve shows the title in the full-bleed nav header above, so the
                  page heading would duplicate it — Win has no nav header, so it
                  keeps the in-page title. */}
              {isWinContext && (
                <h1 className="text-3xl font-semibold">{labels.dataTitle}</h1>
              )}
              <p className="text-lg font-normal text-muted-foreground">
                {labels.subheading}
              </p>
            </div>
          )}

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
                  {searchControl}
                </div>
              </div>

              {/* Same gate as the heading: the stat cards are labelled
                  "Voters" (Win) / "Constituents" (Serve), so hold them until
                  the context settles rather than flash the wrong noun. */}
              {isWinContextReady && (
                <div className="mt-6">
                  <ContactsStatsSection
                    totalVisibleContacts={totalSegmentContacts}
                    onlyTotalVisibleContacts={isCustomSegment || !!searchTerm}
                  />
                </div>
              )}

              <div className="flex align-right md:hidden sm:w-full">
                {searchControl}
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
