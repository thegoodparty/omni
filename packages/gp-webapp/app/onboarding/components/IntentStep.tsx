'use client'

import { RadioCardGroup, type RadioCardOption } from './RadioCardGroup'
import type { FollowOnIntent } from './onboardingTypes'

interface IntentStepProps {
  officeName: string
  value: FollowOnIntent | undefined
  onChange: (value: FollowOnIntent) => void
}

export const IntentStep = ({
  officeName,
  value,
  onChange,
}: IntentStepProps): React.JSX.Element => {
  const options: ReadonlyArray<RadioCardOption<FollowOnIntent>> = [
    {
      value: 'same-office',
      title: "I'm running for the same office",
      description: `Run again for ${officeName}. We'll carry over your office details.`,
    },
    {
      value: 'new-office',
      title: "I'm running for a new office",
      description: 'Start a campaign for a different seat.',
    },
  ]

  return (
    <RadioCardGroup
      name="follow-on-intent"
      value={value}
      onChange={onChange}
      options={options}
    />
  )
}
