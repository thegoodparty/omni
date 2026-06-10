import { cn } from '@styleguide/lib/utils'

// Soft tinted swoosh behind the status icon. It's a single alpha mask recolored
// by `swooshColorClassName`, so one asset serves all three states.
const SWOOSH_MASK_URL = '/images/dashboard/compliance-swoosh.png'

interface ComplianceCardArtProps {
  icon: React.ReactNode
  // bg-* utility for the swoosh tint (e.g. 'bg-warning-100').
  swooshColorClassName: string
}

const maskStyle = {
  maskImage: `url(${SWOOSH_MASK_URL})`,
  WebkitMaskImage: `url(${SWOOSH_MASK_URL})`,
  maskSize: '100% 100%',
  WebkitMaskSize: '100% 100%',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
} as const

export default function ComplianceCardArt({
  icon,
  swooshColorClassName,
}: ComplianceCardArtProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 w-48 select-none"
    >
      <div
        className={cn(
          'absolute right-0 top-1/2 h-40 w-48 -translate-y-1/2',
          swooshColorClassName,
        )}
        style={maskStyle}
      />
      <div className="absolute right-10 top-1/2 -translate-y-1/2">{icon}</div>
    </div>
  )
}
