import Image from 'next/image'
import { Badge } from '@radix-ui/themes'

export function ProBadge() {
  return (
    <Badge {...{ color: 'blue', variant: 'solid' }}>
      <Image {...{
        src: '/images/heart.svg',
        alt: '',
        width: 12,
        height: 10,
        unoptimized: true,
      }} />
      Pro
    </Badge>
  )
}
