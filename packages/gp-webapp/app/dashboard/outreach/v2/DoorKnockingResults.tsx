import { useQuery } from '@tanstack/react-query'
import type { DoorKnockingCampaignResults } from '@goodparty_org/contracts'
import { campaignResultsQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'
import { DetailsSection } from './listDetails/ListDetailsMetric'
import {
  OutreachResultsCard,
  type OutreachResultRow,
} from './listDetails/OutreachResultsCard'
import { OUTREACH_RESULTS_COPY } from './outreachResultsCopy'

// The same answers the knock form records, in its words, each counted by door.
const resultRows = (
  results: DoorKnockingCampaignResults,
  isServe: boolean,
): OutreachResultRow[] => [
  { label: 'Answered', count: results.byOutcome.answered },
  { label: 'Not home', count: results.byOutcome.not_home },
  { label: 'Refused', count: results.byOutcome.refused_to_engage },
  { label: 'Inaccessible', count: results.byOutcome.inaccessible },
  {
    label: isServe ? 'Not a constituent' : 'Not a voter',
    count: results.byOutcome.not_a_voter,
  },
  ...(isServe
    ? [
        { label: 'Needs follow-up: Yes', count: results.byFollowUp.yes },
        { label: 'Needs follow-up: No', count: results.byFollowUp.no },
      ]
    : [
        { label: 'Support: Yes', count: results.bySupport.supporter },
        { label: 'Support: Unsure', count: results.bySupport.unsure },
        { label: 'Support: No', count: results.bySupport.non_supporter },
        { label: 'Will vote: Yes', count: results.byWillVote.yes },
        { label: 'Will vote: No', count: results.byWillVote.no },
        { label: 'Will vote: Unsure', count: results.byWillVote.unsure },
        { label: 'Already voted', count: results.byWillVote.already_voted },
      ]),
]

interface DoorKnockingResultsProps {
  anchorOutreachId: number
  isServe: boolean
}

// Across every turf in the campaign, so it is drawn once for the campaign
// rather than per turf. Left out until a door has been knocked.
export const DoorKnockingResults = ({
  anchorOutreachId,
  isServe,
}: DoorKnockingResultsProps) => {
  const { data } = useQuery(campaignResultsQueryOptions(anchorOutreachId))
  if (!data || data.doorsKnocked === 0) return null
  return (
    <DetailsSection title={OUTREACH_RESULTS_COPY.title}>
      <OutreachResultsCard
        basedOn={OUTREACH_RESULTS_COPY.basedOn(
          data.doorsKnocked,
          'door knocked',
          'doors knocked',
        )}
        total={data.doorsKnocked}
        rows={resultRows(data, isServe)}
      />
    </DetailsSection>
  )
}
