import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import {
  useDoorKnockingCanvasser,
  useDoorKnockingOfficeName,
  useDoorKnockingServeMode,
} from './doorKnockingSurface'
import {
  buildIntro,
  buildScriptIssues,
  buildServeIntro,
  buildVolunteerIntro,
  type ScriptIssue,
} from './doorScriptContent'

// Read here rather than prop-drilling through WalkView and the stop list: the
// script depends on the campaign, not on which door is open — and, the same
// argument again, on the surface rather than on anything PersonSheet knows.
export const useDoorScript = (): { intro: string; issues: ScriptIssue[] } => {
  const [campaign] = useCampaign()
  // The candidate's name lives on the user, not on the campaign.
  const [user] = useUser()
  // A talking script is built from the campaign and its issue positions, and
  // a Serve org has neither — so the positions request is never spent on one,
  // rather than firing on an undefined campaign id and self-hiding by accident.
  const serveMode = useDoorKnockingServeMode()
  const officeName = useDoorKnockingOfficeName()
  // Whether the person holding the phone is the candidate or a volunteer for
  // them. Not derivable from the campaign: a volunteer's is null either way.
  const canvasser = useDoorKnockingCanvasser()
  const campaignId = campaign?.id

  const positionsQuery = useQuery({
    queryKey: ['campaign-positions', campaignId],
    queryFn: () =>
      clientRequest('GET /v1/campaigns/:id/positions', {
        id: String(campaignId),
      }).then((res) => res.data),
    // Never for a volunteer, on either rail: the endpoint is the candidate's
    // own, and a volunteer has no campaign id to spend it on anyway.
    enabled: !serveMode && !canvasser.isVolunteer && campaignId !== undefined,
    // Issue stances change when a candidate edits them in Campaign Details,
    // which is not something that happens mid-walk.
    staleTime: 5 * 60 * 1000,
  })

  // Serve gets an opener and nothing under it. That is not a gap waiting to be
  // filled: the issue list is the candidate's own stances from the campaign
  // issues editor, and an elected official has no campaign to have written
  // them in. The card is worth drawing on one line, because the line an
  // official's canvasser most needs is the one that says whose door-knocker
  // they are — a volunteer for a sitting member opens by naming the seat, and
  // that sentence is exactly the one the Win rail was building and Serve was
  // getting blank.
  // Before the surface branch, not inside it: a volunteer walks both rails, and
  // the sentence they need differs from the candidate's on each. Reaching the
  // Serve branch below as a volunteer would introduce them, by their own name,
  // as the office holder — the same class of false claim `buildServeIntro`
  // exists to prevent on the other side.
  if (canvasser.isVolunteer) {
    return {
      intro: buildVolunteerIntro(user, canvasser.representing, serveMode),
      // The stances under the opener are the candidate's own, read from an
      // endpoint a volunteer cannot call. The generated points that replace
      // them arrive on the route payload instead, which a volunteer can read.
      issues: [],
    }
  }

  if (serveMode) {
    return { intro: buildServeIntro(user, officeName), issues: [] }
  }

  return {
    intro: buildIntro(user, campaign),
    issues: buildScriptIssues(
      positionsQuery.data,
      campaign?.details?.customIssues,
    ),
  }
}
