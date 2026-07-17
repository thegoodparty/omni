'use client'

import { Input, Label } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { numberFormatter } from 'helpers/numberHelper'
import { MAX_SEGMENT_NAME_LENGTH } from '../shared/segments.util'

interface NameStepProps {
  name: string
  onNameChange: (name: string) => void
  count: number | undefined
  isCounting: boolean
  isCapError: boolean
  countErrorMessage: string | undefined
  peopleNoun: string
}

// Step 3: name the list, see the live running total (ENG-10517 pattern reused
// via useListWizardCount), and (in the parent's footer) build it.
export default function NameStep({
  name,
  onNameChange,
  count,
  isCounting,
  isCapError,
  countErrorMessage,
  peopleNoun,
}: NameStepProps) {
  const countMessage = isCapError
    ? countErrorMessage
    : isCounting
      ? 'Counting…'
      : count !== undefined
        ? `${numberFormatter(count)} ${peopleNoun} match`
        : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="list-wizard-name">List name</Label>
        <Input
          id="list-wizard-name"
          value={name}
          onChange={(e) =>
            onNameChange(e.target.value.slice(0, MAX_SEGMENT_NAME_LENGTH))
          }
          maxLength={MAX_SEGMENT_NAME_LENGTH}
          placeholder="Name your list"
        />
      </div>
      {countMessage && (
        <Body2
          className={isCapError ? 'text-destructive' : 'text-muted-foreground'}
          aria-live="polite"
        >
          {countMessage}
        </Body2>
      )}
    </div>
  )
}
