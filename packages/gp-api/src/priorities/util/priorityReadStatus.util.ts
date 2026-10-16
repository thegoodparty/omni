import {
  answersNeeded,
  type PriorityReadStatus,
} from '@goodparty_org/contracts'

// The one place a "good read" is decided. Census closeness joins `good` here
// later, with weighting, so every surface that reads it changes together.
export const priorityReadStatus = (input: {
  answers: number
  population: number | null
}): PriorityReadStatus => {
  const needed = answersNeeded(input.population)
  return {
    answers: input.answers,
    needed,
    good: input.answers >= needed,
  }
}
