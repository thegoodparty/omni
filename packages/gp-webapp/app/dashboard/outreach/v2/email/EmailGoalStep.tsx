import { Input, Label } from '@styleguide'
import { PurposeStepCards } from './PurposeStepCards'
import { Intro } from '../social/Intro'
import type { EmailSurface } from './emailSurface'

interface EmailGoalStepProps {
  surface: EmailSurface
  goalId: string | null
  customGoal: string
  onSelect: (id: string) => void
  onCustomGoalChange: (value: string) => void
}

export const EmailGoalStep = ({
  surface,
  goalId,
  customGoal,
  onSelect,
  onCustomGoalChange,
}: EmailGoalStepProps) => (
  <div className="space-y-6">
    <Intro title={surface.goal.title} body={surface.goal.caption} />
    <PurposeStepCards
      goals={surface.goals}
      selected={goalId}
      onSelect={onSelect}
    />
    {goalId === surface.customGoalId && (
      <div className="space-y-2">
        <Label htmlFor="email-custom-goal">{surface.goal.customLabel}</Label>
        <Input
          id="email-custom-goal"
          value={customGoal}
          maxLength={500}
          onChange={(e) => onCustomGoalChange(e.target.value)}
        />
      </div>
    )}
  </div>
)
