import Link from 'next/link'
import { SEE_ALL_PLANS_LABEL } from './planPitch'

interface SeeAllPlansLinkProps {
  href: string
  className?: string
  onClick?: () => void
}

export const SeeAllPlansLink = ({
  href,
  className = 'text-sm font-medium text-primary underline',
  onClick,
}: SeeAllPlansLinkProps): React.JSX.Element => (
  <Link href={href} className={className} onClick={onClick}>
    {SEE_ALL_PLANS_LABEL}
  </Link>
)
