import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachChannel } from 'app/dashboard/outreach/util/outreachAnalytics'

// Where a saved voter list was made. One value per place that saves one, so
// the count of lists can be split by path without a second event.
export type ListCreatedSource =
  | 'crmWizard'
  | 'duplicate'
  | 'outreachBuilder'
  | 'outreachAllVoters'
  | 'recommendedList'
  | 'aiProposal'
  | 'followUp'
  | 'civicPanel'

interface TrackListCreatedParams {
  isServe: boolean
  source: ListCreatedSource
  listId: number
  // The outreach channel the list was made for, when it was made inside one,
  // in whatever spelling the caller has; it is sent as the outreach events'
  // `medium` so lists and campaigns cut by the same values.
  channel?: string
  properties?: Record<string, unknown>
}

// Every saved voter list fires List Created, whatever else its path records
// (DATA-2307). Campaign success counts lists off this one event, so a save
// that skips it drops out of the count with no error.
export const trackListCreated = ({
  isServe,
  source,
  listId,
  channel,
  properties,
}: TrackListCreatedParams): void => {
  trackEvent(
    isServe ? EVENTS.ConstituentData.ListCreated : EVENTS.VoterData.ListCreated,
    {
      source,
      listId,
      ...(channel ? { medium: outreachChannel(channel) } : {}),
      ...properties,
    },
  )
}
