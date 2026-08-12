import React from 'react'
import { FaSquareXTwitter } from 'react-icons/fa6'

interface TwitterLogoProps {
  size?: number
  color?: string
}

export default function TwitterLogo({
  size = 18,
  color,
}: TwitterLogoProps): React.JSX.Element {
  return <FaSquareXTwitter size={size} color={color} />
}
