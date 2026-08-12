import React from 'react'
import { FaYoutube } from 'react-icons/fa'

interface YoutubeLogoProps {
  size?: number
}

export default function YoutubeLogo({
  size = 18,
}: YoutubeLogoProps): React.JSX.Element {
  return <FaYoutube size={size} color="#FF0000" />
}
