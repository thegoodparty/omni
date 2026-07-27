export interface SmsTemplate {
  key: string
  name?: string
  requiresQuestions?: string[]
}

export const hasRequiredQuestions = (template: SmsTemplate) =>
  (Array.isArray(template.requiresQuestions) &&
    template.requiresQuestions?.length) ||
  template.requiresQuestions
