import React from 'react'
import { FaTiktok } from 'react-icons/fa6'

interface TiktokLogoProps {
  size?: number
  color?: string
}

export default function TiktokLogo({
  size = 18,
  color,
}: TiktokLogoProps): React.JSX.Element {
  return <FaTiktok size={size} color={color} />
}
