import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { PriorityAnswerSource } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { MessageSquareIcon } from '@styleguide'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import { InfoSection } from './InfoSection'
import { PRIORITY_ANSWER_LABELS, priorityHref } from './PriorityAnswerLine'

const SERVE_PRIORITY_ANSWERS_COPY = {
  title: "What they've told you",
  channels: {
    text: 'By text',
    phone_banking: 'On the phone',
    door_knocking: 'At the door',
  } satisfies Record<PriorityAnswerSource, string>,
}

// Renders nothing until they have answered a priority, so a contact nobody
// has asked is unchanged. Serve only: priorities are an office's.
export const PriorityAnswersSection = ({
  personId,
  isServe,
}: {
  personId: string
  isServe: boolean
}) => {
  const { enabled } = useServeCitizenPanelsFlag(false)
  const active = isServe && enabled
  const { data } = useQuery({
    queryKey: ['contact-engagement', 'priority-answers', personId],
    queryFn: () =>
      clientRequest('GET /v1/contact-engagement/:id/priority-answers', {
        id: personId,
      }).then((res) => res.data),
    enabled: active,
  })

  const answers = data?.results ?? []
  if (!active || answers.length === 0) return null

  return (
    <InfoSection
      title={SERVE_PRIORITY_ANSWERS_COPY.title}
      icon={<MessageSquareIcon size={24} />}
    >
      <ul className="flex flex-col gap-3">
        {answers.map((answer) => (
          <li key={answer.id} className="flex flex-col gap-1">
            <Link
              className="text-sm font-medium text-info underline"
              href={priorityHref(answer.priorityId)}
            >
              {answer.priorityTitle}
            </Link>
            <p className="text-sm text-foreground">
              {PRIORITY_ANSWER_LABELS[answer.answer] ?? answer.answer}
              <span className="text-muted-foreground">
                {' · '}
                {SERVE_PRIORITY_ANSWERS_COPY.channels[answer.source] ??
                  answer.source}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </InfoSection>
  )
}
