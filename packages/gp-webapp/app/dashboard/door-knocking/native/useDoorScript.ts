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
  composeTalkingPointsBullets,
  parseTalkingPoints,
} from './talkingPointsCard'
import {
  buildIntro,
  buildScriptIssues,
  buildServeIntro,
  buildVolunteerIntro,
  type ScriptIssue,
} from './doorScriptContent'

export interface DoorScriptCard {
  intro: string
  // The candidate's own issue stances, from the campaign issues editor. The
  // fallback card, for a list frozen before the wizard had a points step.
  issues: ScriptIssue[]
  // The stored card's bullets. Non-empty and `issues` empty, or the reverse —
  // never both, because two lists of advice at one door is neither.
  points: string[]
}

// The campaign and the surface are read here rather than prop-drilled through
// WalkView and the stop list: the script depends on the campaign, not on which
// door is open — and, the same argument again, on the surface rather than on
// anything PersonSheet knows.
//
// The stored points are the exception and arrive as an argument, because they
// are neither: they belong to the LIST, and the route payload holding them is
// WalkView's own fetch. A fourth context for a value that already has an owner
// one hop up would be indirection for its own sake.
export const useDoorScript = (
  // The `talkingPoints` off the route payload — absent for every list created
  // before the points step shipped, and for every candidate who skipped it.
  storedPoints?: string | null,
): DoorScriptCard => {
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

  // Null for a list with no stored card, and for a stored value this version
  // cannot read — both mean "fall back to the static build", which is what
  // every list created before this shipped needs.
  const lines = parseTalkingPoints(storedPoints)
  const points = lines ? composeTalkingPointsBullets(lines) : []

  const positionsQuery = useQuery({
    queryKey: ['campaign-positions', campaignId],
    queryFn: () =>
      clientRequest('GET /v1/campaigns/:id/positions', {
        id: String(campaignId),
      }).then((res) => res.data),
    // Never for a volunteer, on either rail: the endpoint is the candidate's
    // own, and a volunteer has no campaign id to spend it on anyway. Never
    // for a list that carries its own card either — the stances it would
    // fetch are the fallback, and the fallback is not what is being drawn.
    enabled:
      !serveMode &&
      !canvasser.isVolunteer &&
      campaignId !== undefined &&
      points.length === 0,
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
      // endpoint a volunteer cannot call — which is the whole reason the
      // stored points ride the route payload instead. A volunteer on a list
      // that has them reads the same card the candidate does; on a list that
      // does not, they still get the opener alone.
      issues: [],
      points,
    }
  }

  if (serveMode) {
    return { intro: buildServeIntro(user, officeName), issues: [], points }
  }

  return {
    intro: buildIntro(user, campaign),
    // The stored card replaces the stances rather than joining them: both are
    // answers to "what do I say here", and a door is not the place to read
    // two. A list frozen before the points step has no card, and the stances
    // are what it has always shown.
    issues:
      points.length > 0
        ? []
        : buildScriptIssues(
            positionsQuery.data,
            campaign?.details?.customIssues,
          ),
    points,
  }
}
