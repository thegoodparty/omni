'use client'

import { useCrmEnabled } from '../../shared/useCrmEnabled'
import ContactsPage from '../[[...attr]]/components/ContactsPage'
import { CrmContactsPage } from './CrmContactsPage'

// Whole-page CRM gate: a flag-on org gets only the new CRM surface; everyone
// else (flag off or not yet settled) gets the pre-CRM page unchanged — the two
// UIs never mix. This is the single point where treatment and control diverge,
// so the experiment exposure fires here (trackExposure) for both arms.
export const ContactsPageGate = () => {
  const { enabled, ready } = useCrmEnabled(true)
  return ready && enabled ? <CrmContactsPage /> : <ContactsPage />
}
