import React from 'react'
import { FaXTwitter } from 'react-icons/fa6'

interface XLogoProps {
  size?: number
}

// The bare X letterform (no filled square), unlike TwitterLogo's
// FaSquareXTwitter — reads as an outline glyph alongside lucide icons.
export default function XLogo({ size = 18 }: XLogoProps): React.JSX.Element {
  return <FaXTwitter size={size} />
}
