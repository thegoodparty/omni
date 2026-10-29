import { notFound } from 'next/navigation'
import GenUiA2uiPlayground from './GenUiA2uiPlayground'

// Read at request time from VERCEL_ENV, Vercel's reserved server-side var:
// NEXT_PUBLIC_VERCEL_TARGET_ENV is not reliably set on previews (see
// app/layout.tsx), and a statically rendered page would bake in the 404.
export const dynamic = 'force-dynamic'

export default function GenUiA2uiPage() {
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.VERCEL_ENV !== 'preview'
  ) {
    notFound()
  }
  return <GenUiA2uiPlayground />
}
