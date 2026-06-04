/**
 * Interface for image dimensions
 */
export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Gets the dimensions of an image from a URL (works with S3 URLs)
 * @param imageUrl - The URL of the image to get dimensions for
 * @returns Promise that resolves to an object with width and height
 */
export function getImageDimensions(imageUrl: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      reject(new Error('getImageDimensions can only be used in browser environment'))
      return
    }

    if (!imageUrl) {
      reject(new Error('Image URL is required'))
      return
    }

    const img = new Image()
    
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight
      })
    }
    
    img.onerror = (error) => {
      reject(new Error(`Failed to load image: ${imageUrl}. ${error}`))
    }
    
    // Handle CORS for S3 URLs
    img.crossOrigin = 'anonymous'
    img.src = imageUrl
  })
}

/**
 * Gets image dimensions with error handling and fallback
 * @param imageUrl - The URL of the image to get dimensions for
 * @param fallback - Optional fallback dimensions if image fails to load
 * @returns Promise that resolves to dimensions or fallback
 */
export async function getImageDimensionsWithFallback(
  imageUrl: string,
  fallback?: ImageDimensions
): Promise<ImageDimensions | null> {
  try {
    return await getImageDimensions(imageUrl)
  } catch (error) {
    console.warn('Failed to get image dimensions:', error)
    return fallback || null
  }
}

/**
 * Server-side function to get image dimensions using fetch and buffer processing
 * This can be used in API routes or server components
 * @param imageUrl - The URL of the image to get dimensions for
 * @returns Promise that resolves to dimensions
 */
export async function getImageDimensionsServer(imageUrl: string): Promise<ImageDimensions> {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
    }
    
    const buffer = await response.arrayBuffer()
    const uint8Array = new Uint8Array(buffer)
    
    // Basic JPEG dimension parsing
    if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
      return parseJPEGDimensions(uint8Array)
    }
    
    // Basic PNG dimension parsing
    if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
      return parsePNGDimensions(uint8Array)
    }
    
    throw new Error('Unsupported image format. Only JPEG and PNG are supported.')
  } catch (error) {
    throw new Error(`Failed to get image dimensions: ${error}`)
  }
}

/**
 * Parse JPEG image dimensions from buffer
 */
function parseJPEGDimensions(buffer: Uint8Array): ImageDimensions {
  let offset = 2 // Skip SOI marker
  
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) break
    
    const marker = buffer[offset + 1]
    
    // SOF0, SOF1, SOF2 markers contain dimension info
    if (marker >= 0xC0 && marker <= 0xC3) {
      const height = (buffer[offset + 5] << 8) | buffer[offset + 6]
      const width = (buffer[offset + 7] << 8) | buffer[offset + 8]
      return { width, height }
    }
    
    // Skip to next marker
    const segmentLength = (buffer[offset + 2] << 8) | buffer[offset + 3]
    offset += 2 + segmentLength
  }
  
  throw new Error('Could not parse JPEG dimensions')
}

/**
 * Parse PNG image dimensions from buffer
 */
function parsePNGDimensions(buffer: Uint8Array): ImageDimensions {
  // PNG width is at bytes 16-19, height at bytes 20-23
  const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19]
  const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23]
  
  return { width, height }
}