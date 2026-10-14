// Shared by the Priorities page and Serve onboarding, so a priority added in
// either place asks the same questions and needs nothing filled in later.
export const PRIORITY_FORM_COPY = {
  titleLabel: 'What do you want to get done?',
  titlePlaceholder: 'Fix the flooding on Oak Street',
  titleMaxLength: 120,
  descriptionLabel: 'Why does it matter?',
  descriptionPlaceholder: 'A sentence in your own words is plenty.',
  descriptionMaxLength: 600,
} as const
