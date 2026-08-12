import React from 'react'
import { FaTiktok } from 'react-icons/fa6'

interface TiktokLogoProps {
  size?: number
}

export default function TiktokLogo({
  size = 18,
}: TiktokLogoProps): React.JSX.Element {
  return <FaTiktok size={size} />
}
