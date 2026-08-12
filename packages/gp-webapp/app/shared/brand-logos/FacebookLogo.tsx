import React from 'react'
import { FaFacebook } from 'react-icons/fa'

interface FacebookLogoProps {
  size?: number
  color?: string
}

export default function FacebookLogo({
  size = 18,
  color = '#1877F2',
}: FacebookLogoProps): React.JSX.Element {
  return <FaFacebook size={size} color={color} />
}
