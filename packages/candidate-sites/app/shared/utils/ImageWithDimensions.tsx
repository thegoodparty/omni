'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { getImageDimensionsWithFallback, ImageDimensions } from './getImageDimensions'

interface ImageWithDimensionsProps {
  src: string
  alt: string
  className?: string
  fallbackDimensions?: ImageDimensions
}

/**
 * Example component that displays an image and shows its actual dimensions
 * This demonstrates how to use the getImageDimensions utility in a React component
 */
export default function ImageWithDimensions({
  src,
  alt,
  className = '',
  fallbackDimensions = { width: 1280, height: 640 }
}: ImageWithDimensionsProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadImageDimensions() {
      if (!src) return

      setLoading(true)
      setError(null)

      try {
        const imageDimensions = await getImageDimensionsWithFallback(src, fallbackDimensions)
        setDimensions(imageDimensions)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load image dimensions')
        setDimensions(fallbackDimensions)
      } finally {
        setLoading(false)
      }
    }

    loadImageDimensions()
  }, [src, fallbackDimensions])

  if (!src) {
    return null
  }

  return (
    <div className={`relative ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={dimensions?.width || fallbackDimensions.width}
        height={dimensions?.height || fallbackDimensions.height}
        className="w-full object-contain"
        priority
      />
      
      {/* Optional: Display dimension info (for debugging/development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 text-xs rounded">
          {loading && 'Loading dimensions...'}
          {error && `Error: ${error}`}
          {dimensions && !loading && !error && 
            `${dimensions.width} × ${dimensions.height}`
          }
        </div>
      )}
    </div>
  )
}