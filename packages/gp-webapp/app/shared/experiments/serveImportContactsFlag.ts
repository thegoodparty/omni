import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { useFlagOn } from './FeatureFlagsProvider'

// Gates Import contacts on Serve and, with Pro, on Win: the Import contacts
// and Upload history actions on the contacts page, the upload pages, and the
// import provenance on a person's record. gp-api gates its upload routes on
// the same key, read for the org's owner, so the surface and the API roll out
// together.
//
// The flag gates rollout, not access. @UseOrganization() at gp-api remains the
// real check.
export const useServeImportContactsFlag = (
  trackExposure = true,
): { ready: boolean; enabled: boolean } => {
  const { ready, on } = useFlagOn(SERVE_IMPORT_CONTACTS_FLAG, {
    trackExposure,
  })
  return { ready, enabled: on }
}
