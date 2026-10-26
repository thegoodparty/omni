import Link from 'next/link'
import type { PriorityAnswerCode } from '@goodparty_org/contracts'
import type { ConstituentPriorityAnswer } from '../shared/contacts-types'

export const PRIORITY_ANSWER_LABELS: Record<PriorityAnswerCode, string> = {
  yes: 'Yes',
  no: 'No',
  mixed: 'Mixed',
  not_an_answer: 'No clear answer',
}

export const priorityHref = (priorityId: string): string =>
  `/dashboard/priorities/${priorityId}`

// The coded answer is an AI's reading of what they said, so a reply that
// was not an answer reads as a question asked, not an answer given.
export const PriorityAnswerLine: React.FC<{
  priorityAnswer: ConstituentPriorityAnswer | null | undefined
}> = ({ priorityAnswer }) =>
  priorityAnswer ? (
    <p className="text-sm font-normal text-muted-foreground">
      {priorityAnswer.answer === 'not_an_answer' ? 'Asked about' : 'Answered'}{' '}
      <Link
        className="font-medium text-info underline"
        href={priorityHref(priorityAnswer.priorityId)}
      >
        {priorityAnswer.priorityTitle}
      </Link>
      :{' '}
      <span className="text-foreground">
        {PRIORITY_ANSWER_LABELS[priorityAnswer.answer] ?? priorityAnswer.answer}
      </span>
    </p>
  ) : null
