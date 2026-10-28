// One placeholder per feature whose backend has not shipped. Each later PR
// replaces the usage that carries its `feature` id with the real control.
export type EmailPlaceholderFeature =
  | 'ai-draft'
  | 'image'
  | 'test-send'
  | 'price'
  | 'pay'
  | 'status'

export const EmailComingSoon = ({
  feature,
  label,
}: {
  feature: EmailPlaceholderFeature
  label: string
}) => (
  <div
    data-testid={`email-coming-soon-${feature}`}
    className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm"
  >
    <span className="text-foreground">{label}</span>
    <span className="shrink-0 text-muted-foreground">Coming soon</span>
  </div>
)
