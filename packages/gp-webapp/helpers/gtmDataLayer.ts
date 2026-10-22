// Bridge to the Google Tag Manager dataLayer.
//
// GA4 is not called from this codebase. The GTM container loaded in
// app/layout.tsx owns the GA4 tags, while every product event goes to Segment
// (helpers/analyticsHelper.ts). GA4 therefore only sees what GTM can observe
// on its own: page views and whatever this file pushes. Two things are pushed
// here so GA4 can be reconciled against HubSpot and Amplitude:
//
// - `user_id`, the gp-api user id, pushed whenever the signed-in user resolves.
//   A GTM dataLayer variable reads it into the GA4 configuration's User-ID
//   field, which is the only key GA4 and HubSpot share.
// - `sign_up`, pushed once per fresh registration from
//   trackRegistrationCompleted, so a GTM custom-event trigger can emit the GA4
//   `sign_up` event. Pro purchases already reach GA4 as `purchase` from GTM and
//   are deliberately not pushed again here.
//
// The GTM snippet creates window.dataLayer, but these pushes can run before it
// loads (or when it never loads off production), so the array is created on
// demand: GTM replays any entries that were queued before it initialized.

type DataLayerEntry = Record<string, unknown>

// Cast through unknown: HubSpotForm.tsx declares window.dataLayer globally
// with a required `event`, which is wrong for the user_id-only entry.
type WindowWithDataLayer = { dataLayer?: DataLayerEntry[] }

export const pushToDataLayer = (entry: DataLayerEntry): void => {
  if (typeof window === 'undefined') return
  const w = window as unknown as WindowWithDataLayer
  w.dataLayer = w.dataLayer || []
  w.dataLayer.push(entry)
}

// Pushed as a string because GA4's User-ID field is a string, and pushed as
// `undefined` on sign-out so a later GTM read does not keep the previous
// user's id.
export const setDataLayerUserId = (
  userId: string | number | null | undefined,
): void => {
  pushToDataLayer({ user_id: userId == null ? undefined : String(userId) })
}

export const pushSignUpToDataLayer = ({
  userId,
  method,
}: {
  userId: string | number
  method: string
}): void => {
  pushToDataLayer({ event: 'sign_up', method, user_id: String(userId) })
}
