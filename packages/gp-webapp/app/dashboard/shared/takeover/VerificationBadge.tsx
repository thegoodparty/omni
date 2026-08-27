import { Badge } from '@styleguide'

// The design's "Verification" pill (verify-phase screens + the SMS flow's
// verification interstitial). One component so the pill can't drift between
// the compliance pages and the outreach surfaces.
export const VerificationBadge = () => (
  <Badge
    shape="pill"
    className="h-6.5 gap-1.5 border-transparent bg-info-light px-3 text-xs font-semibold text-foreground"
  >
    Verification
  </Badge>
)
