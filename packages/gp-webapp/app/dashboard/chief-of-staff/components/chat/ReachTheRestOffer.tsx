import { useQuery } from '@tanstack/react-query'
import type {
  ChatClarifyQuestion,
  CivicPanelReachOptions,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import ClarifyQuestionWidget from '../../../shared/agent-chat/ClarifyQuestionWidget'
import { CompactCardLoading } from '../../../shared/agent-chat/cards/cardShell'
import { useReachList } from '../../../contacts/citizens-panel/components/useReachList'

export const REACH_THE_REST_QUESTION_ID = 'civic_panel_reach_the_rest'

export const reachTheRestQueryOptions = (orgSlug: string | undefined) => ({
  queryKey: ['civic-panel-reach-options', orgSlug],
  queryFn: async (): Promise<CivicPanelReachOptions> =>
    (await clientRequest('GET /v1/contacts/civic-panel/reach-options', {}))
      .data,
})

// The short groups as one question, each option's line the seats it is
// short and the homes the door or the call reaches.
export const reachTheRestQuestion = (
  reach: CivicPanelReachOptions,
): ChatClarifyQuestion => ({
  questionId: REACH_THE_REST_QUESTION_ID,
  question: 'Where do you want to start?',
  options: reach.options.map(({ label, detail }) => ({
    label,
    rationale: detail,
  })),
  multiSelect: false,
})

// What the Chief of Staff offers once every resident a text can reach has
// an invite: read live, so the groups are the ones the civic panel page
// lists now. Picking one answers the question and opens door knocking or
// phone banking on a list of that group.
export const ReachTheRestOffer = ({
  disabled,
  answer,
  onAnswer,
}: {
  disabled: boolean
  answer?: string
  onAnswer: (answer: string) => void
}) => {
  const orgSlug = useOrganization()?.slug
  const { data } = useQuery({
    ...reachTheRestQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  const reach = useReachList()
  if (!data) return <CompactCardLoading />
  if (data.options.length === 0) return null
  return (
    <div className="w-full" data-testid="reach-the-rest-offer">
      <ClarifyQuestionWidget
        question={reachTheRestQuestion(data)}
        disabled={disabled || reach.pending !== null}
        answer={answer}
        onAnswer={(picked) => {
          onAnswer(picked)
          const option = data.options.find(({ label }) => label === picked)
          if (option) {
            void reach.reach(option.group, option.channel, option.label)
          }
        }}
        showWrittenAnswer={false}
        plainRationale
      />
      {reach.flow}
    </div>
  )
}
