import { COMMUNITY_INPUT_QUESTION_MAX_LENGTH } from '@goodparty_org/contracts'
import { Textarea } from '@styleguide'

// Serve-only: this step is reached only from the `community_input` purpose,
// which exists only in the Serve vocabulary. In a SERVE_ declaration so the
// vocabulary gate can read it (docs/product-vocabulary.md).
const SERVE_QUESTION_COPY = {
  caption: 'One clear question, in the words you would say out loud.',
  placeholder:
    'Would you take part in a compost pilot, and how do you feel about it?',
  label: 'The question',
}

interface QuestionStepProps {
  question: string
  onChange: (next: string) => void
}

export const QuestionStep = ({ question, onChange }: QuestionStepProps) => (
  <div className="flex flex-col gap-4">
    <p className="text-sm text-muted-foreground">
      {SERVE_QUESTION_COPY.caption}
    </p>
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
  </div>
)
