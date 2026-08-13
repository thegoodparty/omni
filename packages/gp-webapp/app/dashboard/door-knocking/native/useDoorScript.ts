import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useCampaign } from '@shared/hooks/useCampaign'
import {
  buildIntro,
  buildScriptIssues,
  type ScriptIssue,
} from './doorScriptContent'

// Read here rather than prop-drilling through WalkView and the stop list: the
// script depends on the campaign, not on which door is open.
export const useDoorScript = (): { intro: string; issues: ScriptIssue[] } => {
  const [campaign] = useCampaign()
  const campaignId = campaign?.id

  const positionsQuery = useQuery({
    queryKey: ['campaign-positions', campaignId],
    queryFn: () =>
      clientRequest('GET /v1/campaigns/:id/positions', {
        id: String(campaignId),
      }).then((res) => res.data),
    enabled: campaignId !== undefined,
    // Issue stances change when a candidate edits them in Campaign Details,
    // which is not something that happens mid-walk.
    staleTime: 5 * 60 * 1000,
  })

  return {
    intro: buildIntro(campaign),
    issues: buildScriptIssues(
      positionsQuery.data,
      campaign?.details?.customIssues,
    ),
  }
}
