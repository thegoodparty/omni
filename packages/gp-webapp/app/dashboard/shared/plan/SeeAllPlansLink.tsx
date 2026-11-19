import Link from 'next/link'
import { SEE_ALL_PLANS_LABEL } from './planPitch'

interface SeeAllPlansLinkProps {
  href: string
  className?: string
}

export const SeeAllPlansLink = ({
  href,
  className = 'text-sm font-medium text-primary underline',
}: SeeAllPlansLinkProps): React.JSX.Element => (
  <Link href={href} className={className}>
    {SEE_ALL_PLANS_LABEL}
  </Link>
)
