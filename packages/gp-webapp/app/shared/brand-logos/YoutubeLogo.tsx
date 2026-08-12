import React from 'react'
import { FaYoutube } from 'react-icons/fa'

interface YoutubeLogoProps {
  size?: number
  color?: string
}

export default function YoutubeLogo({
  size = 18,
  color = '#FF0000',
}: YoutubeLogoProps): React.JSX.Element {
  return <FaYoutube size={size} color={color} />
}
