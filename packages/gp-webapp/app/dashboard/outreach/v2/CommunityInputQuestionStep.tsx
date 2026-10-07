import { COMMUNITY_INPUT_QUESTION_MAX_LENGTH } from '@goodparty_org/contracts'
import { Textarea } from '@styleguide'

// Shared by the phone-banking flow and the door-knocking create flow, which
// ask the same thing in the same words. Both are reached only from the
// `community_input` purpose, which both products carry: Win's "Hear from
// voters" and Serve's community input.
//
// Renders NO title or caption of its own: phone banking heads its steps with
// `Intro` and door knocking with `STAGE_META`, so a heading here would be the
// second one on the screen.
//
// Mode-keyed although the two read the same today, so the Serve branch stays
// where the vocabulary gate reads it (docs/product-vocabulary.md).
const QUESTION_COPY = {
  win: {
    label: 'The question',
    // Shows the shape of a useful answer rather than restating the question:
    // an issue plus a position to learn about, which is what the extraction
    // downstream is looking for.
    placeholder:
      'Describe an issue and a position that you want to learn more about, ' +
      'like "How do you feel about energy costs in your area?"',
  },
  serve: {
    label: 'The question',
    placeholder:
      'Describe an issue and a position that you want to learn more about, ' +
      'like "How do you feel about energy costs in your area?"',
  },
}

interface CommunityInputQuestionStepProps {
  question: string
  onChange: (next: string) => void
  isServe: boolean
}

export const CommunityInputQuestionStep = ({
  question,
  onChange,
  isServe,
}: CommunityInputQuestionStepProps) => {
  const copy = isServe ? QUESTION_COPY.serve : QUESTION_COPY.win
  return (
    <div>
      <label
        htmlFor="community-input-question"
        className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground"
      >
        {copy.label}
      </label>
      <Textarea
        id="community-input-question"
        className="mt-2 min-h-24"
        value={question}
        maxLength={COMMUNITY_INPUT_QUESTION_MAX_LENGTH}
        placeholder={copy.placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
