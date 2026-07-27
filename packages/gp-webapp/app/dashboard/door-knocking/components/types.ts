export interface EcanvasserSummary {
  totalInteractions?: number
  totalContactAttempts?: number
  totalHouseholds?: number
  lastSync?: string
  averageRating?: number
  interactions?: Partial<Record<string, number>>
  interactionsByDay?: Partial<Record<string, Partial<Record<string, number>>>>
  groupedRatings?: Partial<Record<string, number>>
}
