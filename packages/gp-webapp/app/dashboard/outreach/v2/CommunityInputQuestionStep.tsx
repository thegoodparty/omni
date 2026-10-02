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
  // Shows the shape of a useful answer rather than restating the question:
  // an issue plus a position to learn about, which is what the extraction
  // downstream is looking for.
  placeholder:
    'Describe an issue and a position that you want to learn more about, ' +
    'like "How do you feel about energy costs in your area?"',
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
