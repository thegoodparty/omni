import { notFound } from 'next/navigation'
import { GenUiPlayground } from './GenUiPlayground'

// Read at request time: VERCEL_ENV is Vercel's runtime system var, while
// NEXT_PUBLIC_VERCEL_TARGET_ENV is not populated on these builds.
export const dynamic = 'force-dynamic'

export default function GenUiJsonRenderPage() {
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.VERCEL_ENV !== 'preview'
  ) {
    notFound()
  }
  return <GenUiPlayground />
}
