import { COMMUNITY_INPUT_QUESTION_MAX_LENGTH } from '@goodparty_org/contracts'
import { Textarea } from '@styleguide'

// Shared by the phone-banking flow and the door-knocking create flow, which
// ask the same thing in the same words. Both are reached only from the
// `community_input` purpose, which exists only in the Serve vocabulary.
//
// Renders NO title or caption of its own: phone banking heads its steps with
// `Intro` and door knocking with `STAGE_META`, so a heading here would be the
// second one on the screen.
const SERVE_QUESTION_COPY = {
  label: 'The question',
  placeholder:
    'Would you take part in a compost pilot, and how do you feel about it?',
}

interface CommunityInputQuestionStepProps {
  question: string
  onChange: (next: string) => void
}

export const CommunityInputQuestionStep = ({
  question,
  onChange,
}: CommunityInputQuestionStepProps) => (
  <div>
    <label
      htmlFor="community-input-question"
      className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground"
    >
      {SERVE_QUESTION_COPY.label}
    </label>
    <Textarea
      id="community-input-question"
      className="mt-2 min-h-24"
      value={question}
      maxLength={COMMUNITY_INPUT_QUESTION_MAX_LENGTH}
      placeholder={SERVE_QUESTION_COPY.placeholder}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
)
