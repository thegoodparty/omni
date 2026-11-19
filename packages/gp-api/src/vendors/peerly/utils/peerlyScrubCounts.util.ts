import { PhoneListDetailsResponseDto } from '../schemas/peerlyPhoneList.schema'

// Peerly's per-reason counts for leads it dropped from an uploaded list.
// leads_loaded is the only one the product reads, so without these the gap
// between what we uploaded and what Peerly will text has no explanation
// (ENG-11484: Florida lists lose 40-55% here, every other state ~1%).
export const peerlyScrubCounts = (details: PhoneListDetailsResponseDto) => ({
  leadsSupplied: details.leads_supplied,
  leadsLoaded: details.leads_loaded,
  leadsDuplicate: details.leads_duplicate,
  leadsMalformed: details.leads_malformed,
  leadsInvalid: details.leads_invalid,
  leadsMasterDnc: details.leads_master_dnc,
  leadsCellDnc: details.leads_cell_dnc,
  leadsAcctDnc: details.leads_acct_dnc,
  leadsNatDnc: details.leads_nat_dnc,
  leadsCellSuppressed: details.leads_cell_suppressed,
  useNatDnc: details.use_nat_dnc,
  suppressCellPhones: details.suppress_cell_phones,
})
